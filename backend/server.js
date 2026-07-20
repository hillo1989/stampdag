require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const pinoHttp = require('pino-http');
const path = require('path');
const jwt = require('jsonwebtoken');
const { z } = require('zod');

const db = require('./db.js');
const anchor = require('./kaspa-anchor.js');
const kaspaCrypto = require('./kaspa-crypto.js');
const { buildCertificatePdf } = require('./certificate.js');

const IS_PROD = process.env.NODE_ENV === 'production';
const PORT = parseInt(process.env.PORT, 10) || 3210;

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: IS_PROD ? undefined : { target: 'pino-pretty' },
});

// Required for wallet-login sessions (§3.9 Stufe 1) -- fail fast rather than silently
// signing tokens with an absent/weak secret.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  logger.error('FATAL: JWT_SECRET is not set. Cannot start.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', IS_PROD ? 1 : false);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes(origin)) return callback(null, true);
      logger.warn({ origin }, 'CORS blocked origin');
      callback(new Error('Not allowed by CORS'));
    },
    credentials: false,
  })
);
app.options('*', cors());

app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX, 10) || 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', globalLimiter);

// Anchor creation is rate-limited more strictly than everything else — the operator
// personally funds every transaction, so this endpoint is the one worth protecting
// from spam/cost-abuse specifically (doc section 3.10).
const anchorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_ANCHOR_MAX, 10) || 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX, 10) || 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// Self-pay anchors (/api/anchor/self) don't cost the operator anything -- the caller's
// own wallet pays the network fee -- so they get their own, more generous limit
// instead of sharing anchorLimiter's tight budget with the operator-funded path.
// Still capped to bound DB/indexer load from a single IP, just not as strictly.
const selfAnchorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_SELF_ANCHOR_MAX, 10) || 60,
  standardHeaders: true,
  legacyHeaders: false,
});

function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const err = new Error(result.error.issues.map((i) => i.message).join('; '));
    err.status = 400;
    throw err;
  }
  return result.data;
}

const Sha256HashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, 'sha256Hash must be a 64-character hex string')
  .transform((s) => s.toLowerCase());

const AnchorRequestSchema = z.object({
  sha256Hash: Sha256HashSchema,
  filename: z.string().max(255).optional(),
});

const VerifyRequestSchema = z
  .object({
    sha256Hash: Sha256HashSchema.optional(),
    txid: z.string().min(1).max(128).optional(),
  })
  .refine((d) => d.sha256Hash || d.txid, { message: 'sha256Hash or txid is required' });

const KaspaAddressSchema = z.string().min(1).max(128);

const AuthChallengeRequestSchema = z.object({ kaspaAddress: KaspaAddressSchema });

const AuthVerifyRequestSchema = z.object({
  kaspaAddress: KaspaAddressSchema,
  signature: z.string().regex(/^[a-f0-9]{128}$/i, 'signature must be a 128-character hex string'),
});

const SelfAnchorRequestSchema = z.object({
  sha256Hash: Sha256HashSchema,
  filename: z.string().max(255).optional(),
  txid: z.string().min(1).max(128),
});

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    // Pin the algorithm explicitly -- without this, jwt.verify() accepts whatever
    // algorithm the token itself claims, which is the classic setup for an algorithm-
    // confusion attack if this code is ever extended to support asymmetric keys.
    req.user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// In-memory, single-use, short-TTL login challenges -- there is no persistent user
// record on the other end (§3.9 Stufe 1 only proves address control for this
// session), so an in-process Map is sufficient and avoids a users table that would
// otherwise have no other purpose. Mirrors KasPay's registration-challenge pattern
// (kaspay-backend/server.js) adapted from one-time registration to repeatable login.
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const loginChallenges = new Map(); // kaspaAddress -> { message, expiresAt }

async function refreshAnchorIfPending(anchorRow) {
  if (anchorRow.status !== 'pending') return anchorRow;
  const status = await anchor.checkConfirmation(anchorRow.txid);
  if (status.status !== anchorRow.status) {
    return db.anchors.updateStatus(anchorRow.txid, {
      status: status.status,
      confirmationsInfo: status.raw,
      confirmedAt: status.confirmedAt,
    });
  }
  return anchorRow;
}

app.post(
  '/api/anchor',
  anchorLimiter,
  asyncHandler(async (req, res) => {
    const { sha256Hash, filename } = validate(AnchorRequestSchema, req.body);

    const existingDoc = await db.documents.findByHash(sha256Hash);
    if (existingDoc) {
      const existingAnchors = await db.anchors.findByDocumentId(existingDoc.id);
      if (existingAnchors.length) {
        const refreshed = await refreshAnchorIfPending(existingAnchors[0]);
        return res.status(200).json({
          anchorId: refreshed.id,
          documentId: existingDoc.id,
          sha256Hash,
          txid: refreshed.txid,
          network: refreshed.network,
          status: refreshed.status,
          submittedAt: refreshed.submittedAt,
          explorerUrl: `${anchor.EXPLORER_URL}/txs/${refreshed.txid}`,
          alreadyAnchored: true,
        });
      }
    }

    const doc = existingDoc || (await db.documents.create({ sha256Hash, filename }));
    const result = await anchor.anchorHash(sha256Hash);
    const anchorRow = await db.anchors.create({
      documentId: doc.id,
      txid: result.txid,
      network: result.network,
      walletAddress: result.walletAddress,
      payloadHex: result.payloadHex,
    });

    res.status(201).json({
      anchorId: anchorRow.id,
      documentId: doc.id,
      sha256Hash,
      txid: result.txid,
      network: result.network,
      status: anchorRow.status,
      submittedAt: anchorRow.submittedAt,
      explorerUrl: result.explorerUrl,
      alreadyAnchored: false,
    });
  })
);

// ---------- Wallet login (§3.9 Stufe 1) ----------
// Stateless: a signed challenge proves "this session controls this address right
// now" and nothing more. No profile data is persisted, so no users table exists --
// the JWT itself (claim: kaspaAddress) *is* the session.
app.post(
  '/api/auth/challenge',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { kaspaAddress } = validate(AuthChallengeRequestSchema, req.body);
    const nonce = crypto.randomBytes(16).toString('hex');
    const message = `stampdag-login|${kaspaAddress}|${nonce}|${Date.now()}`;
    loginChallenges.set(kaspaAddress, { message, expiresAt: Date.now() + CHALLENGE_TTL_MS });
    res.json({ message, expiresInSeconds: CHALLENGE_TTL_MS / 1000 });
  })
);

app.post(
  '/api/auth/verify',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { kaspaAddress, signature } = validate(AuthVerifyRequestSchema, req.body);
    const challenge = loginChallenges.get(kaspaAddress);
    loginChallenges.delete(kaspaAddress); // single-use regardless of outcome
    if (!challenge || challenge.expiresAt < Date.now()) {
      const err = new Error('No active login challenge for this address — request a new one');
      err.status = 401;
      throw err;
    }
    if (!kaspaCrypto.verifyMessage(challenge.message, signature, kaspaAddress)) {
      const err = new Error('Signature verification failed');
      err.status = 401;
      throw err;
    }
    const token = jwt.sign({ kaspaAddress }, JWT_SECRET, { expiresIn: '24h', algorithm: 'HS256' });
    res.json({ token, kaspaAddress });
  })
);

// Records an anchor the client already built, signed, and broadcast itself (via a
// connected wallet) -- this endpoint never signs anything. It only ever writes a
// document/anchor row after independently confirming on-chain that the payload
// matches the claimed hash, so a logged-in client can't get an arbitrary txid
// credited against an unrelated hash.
app.post(
  '/api/anchor/self',
  authMiddleware,
  selfAnchorLimiter,
  asyncHandler(async (req, res) => {
    const { sha256Hash, filename, txid } = validate(SelfAnchorRequestSchema, req.body);

    const existingAnchor = await db.anchors.findByTxid(txid);
    if (existingAnchor) {
      const existingDoc = await db.documents.findById(existingAnchor.documentId);
      if (existingDoc.sha256Hash !== sha256Hash) {
        const err = new Error('This txid is already recorded against a different document hash');
        err.status = 409;
        throw err;
      }
      return res.status(200).json({
        anchorId: existingAnchor.id,
        documentId: existingDoc.id,
        sha256Hash: existingDoc.sha256Hash,
        txid: existingAnchor.txid,
        network: existingAnchor.network,
        status: existingAnchor.status,
        submittedAt: existingAnchor.submittedAt,
        explorerUrl: `${anchor.EXPLORER_URL}/txs/${existingAnchor.txid}`,
        alreadyAnchored: true,
      });
    }

    const confirmation = await anchor.checkConfirmation(txid);
    if (!confirmation.raw) {
      const err = new Error('Transaction not found on-chain yet — retry shortly');
      err.status = 404;
      throw err;
    }
    const expectedPayload = anchor.buildPayloadHex(sha256Hash);
    if (confirmation.raw.payload !== expectedPayload) {
      const err = new Error('On-chain payload does not match the claimed document hash');
      err.status = 422;
      throw err;
    }

    const existingDoc = await db.documents.findByHash(sha256Hash);
    const doc = existingDoc || (await db.documents.create({ sha256Hash, filename }));
    try {
      await db.anchors.create({
        documentId: doc.id,
        txid,
        network: anchor.NETWORK,
        walletAddress: req.user.kaspaAddress,
        payloadHex: expectedPayload,
      });
    } catch (e) {
      // Two concurrent requests for the same txid (retry/double-submit) can both pass
      // the findByTxid check above before either inserts -- the second insert then
      // hits the kaspa_txid UNIQUE constraint. That's a benign race, not a real
      // error: fall through to read back whatever the winning request wrote.
      if (!(await db.anchors.findByTxid(txid))) throw e;
    }
    if (confirmation.status === 'confirmed') {
      await db.anchors.updateStatus(txid, {
        status: 'confirmed',
        confirmationsInfo: confirmation.raw,
        confirmedAt: confirmation.confirmedAt,
      });
    }
    const finalRow = await db.anchors.findByTxid(txid);

    res.status(201).json({
      anchorId: finalRow.id,
      documentId: doc.id,
      sha256Hash,
      txid,
      network: finalRow.network,
      status: finalRow.status,
      submittedAt: finalRow.submittedAt,
      explorerUrl: `${anchor.EXPLORER_URL}/txs/${txid}`,
      alreadyAnchored: false,
    });
  })
);

app.get(
  '/api/anchor/:txid',
  asyncHandler(async (req, res) => {
    let anchorRow = await db.anchors.findByTxid(req.params.txid);
    if (!anchorRow) return res.status(404).json({ error: 'Unknown txid' });
    anchorRow = await refreshAnchorIfPending(anchorRow);
    res.json({
      txid: anchorRow.txid,
      status: anchorRow.status,
      network: anchorRow.network,
      submittedAt: anchorRow.submittedAt,
      confirmedAt: anchorRow.confirmedAt,
      explorerUrl: `${anchor.EXPLORER_URL}/txs/${anchorRow.txid}`,
    });
  })
);

app.post(
  '/api/verify',
  asyncHandler(async (req, res) => {
    const { sha256Hash, txid } = validate(VerifyRequestSchema, req.body);

    // Kaspa TXIDs and SHA-256 document hashes are both 64-char hex strings -- when a
    // client can't tell them apart (e.g. a pasted value of unknown origin) it may send
    // both fields. Try txid first, then fall back to hash, rather than assuming the
    // caller's field choice was correct.
    let anchorRow = null;
    let doc = null;
    if (txid) {
      anchorRow = await db.anchors.findByTxid(txid);
      if (anchorRow) doc = await db.documents.findById(anchorRow.documentId);
    }
    if (!anchorRow && sha256Hash) {
      doc = await db.documents.findByHash(sha256Hash);
      if (doc) {
        const list = await db.anchors.findByDocumentId(doc.id);
        anchorRow = list[0] || null;
      }
    }

    if (!anchorRow || !doc) return res.json({ matched: false });

    anchorRow = await refreshAnchorIfPending(anchorRow);
    res.json({
      matched: true,
      sha256Hash: doc.sha256Hash,
      txid: anchorRow.txid,
      status: anchorRow.status,
      network: anchorRow.network,
      anchoredAt: anchorRow.submittedAt,
      confirmedAt: anchorRow.confirmedAt,
      explorerUrl: `${anchor.EXPLORER_URL}/txs/${anchorRow.txid}`,
      certificateUrl: `/api/certificate/${anchorRow.id}`,
    });
  })
);

app.get(
  '/api/certificate/:id',
  asyncHandler(async (req, res) => {
    const anchorRow = await db.anchors.findById(req.params.id);
    if (!anchorRow) return res.status(404).json({ error: 'Unknown certificate id' });
    const refreshed = await refreshAnchorIfPending(anchorRow);
    const doc = await db.documents.findById(refreshed.documentId);

    const lang = req.query.lang === 'en' ? 'en' : 'de';
    const pdfBuffer = await buildCertificatePdf({
      sha256Hash: doc.sha256Hash,
      txid: refreshed.txid,
      network: refreshed.network,
      status: refreshed.status,
      anchoredAt: refreshed.submittedAt,
      confirmedAt: refreshed.confirmedAt,
      filenameLabel: doc.filename,
      verifyUrl: `${(process.env.FRONTEND_URL || '').replace(/\/$/, '')}/?verify=1&hash=${doc.sha256Hash}&txid=${refreshed.txid}`,
      explorerUrl: `${anchor.EXPLORER_URL}/txs/${refreshed.txid}`,
      lang,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="stampdag-certificate-${doc.sha256Hash.slice(0, 12)}.pdf"`);
    res.send(pdfBuffer);
  })
);

app.get(
  '/api/health',
  asyncHandler(async (req, res) => {
    const dbOk = await Promise.resolve(db.ping()).catch(() => false);
    const balance = await anchor.getWalletBalance().catch(() => null);
    res.json({
      ok: !!dbOk,
      network: anchor.NETWORK,
      walletAddress: anchor.walletAddress,
      walletBalanceSompi: balance ? balance.sompi : null,
    });
  })
);

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    logger.error({ err }, 'unhandled error');
    // Unexpected errors (SDK internals, DB driver messages, etc.) are logged in full
    // server-side but never forwarded to the client -- only deliberate validation/
    // business-logic errors (4xx, thrown with an explicit err.status) carry a message
    // that's safe to expose.
    return res.status(status).json({ error: 'Internal error' });
  }
  res.status(status).json({ error: err.message || 'Internal error' });
});

// Background sweep: flips pending -> confirmed even if no client ever polls again,
// so a certificate downloaded later never shows a permanently stale status.
const SWEEP_INTERVAL_MS = 15000;
async function sweepPendingAnchors() {
  try {
    const pending = await db.anchors.findPending();
    for (const a of pending) {
      await refreshAnchorIfPending(a).catch((e) => logger.warn({ err: e, txid: a.txid }, 'sweep: confirmation check failed'));
    }
  } catch (e) {
    logger.warn({ err: e }, 'sweep failed');
  }
}

if (require.main === module) {
  const server = app.listen(PORT, () => {
    logger.info(`StampDAG backend listening on :${PORT} (network=${anchor.NETWORK}, wallet=${anchor.walletAddress})`);
  });
  const sweepTimer = setInterval(sweepPendingAnchors, SWEEP_INTERVAL_MS);
  process.on('SIGTERM', () => {
    clearInterval(sweepTimer);
    server.close(() => process.exit(0));
  });
}

module.exports = app;
