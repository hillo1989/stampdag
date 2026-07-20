// Integration tests against the real Express app (server.js's routing, validation,
// dedup, and auth logic) via supertest. The network-touching functions in
// kaspa-anchor.js (anchorHash, checkConfirmation, getWalletBalance) are replaced
// in-place with vi.fn() mocks on the shared module.exports object. Both this file's
// require() and server.js's internal require('./kaspa-anchor.js') resolve to the
// identical Node module-cache object (same absolute path, both plain CJS require()),
// so mutating the properties here is visible to server.js's route handlers too.
// (An earlier version of this file tried vi.mock()+import interop for this and hit
// inconsistent default-export wrapping across CJS/ESM boundaries -- confirmed the
// simple direct-mutation approach below is the reliable one for this project's
// plain-CommonJS module shape.) buildPayloadHex/NETWORK/EXPLORER_URL/walletAddress
// stay real (pure, offline). These tests never make a real blockchain call.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const request = require('supertest');
const crypto = require('crypto');
const kaspa = require('@kluster/kaspa-wasm');
const anchor = require('../kaspa-anchor.js');
const app = require('../server.js');

anchor.anchorHash = vi.fn();
anchor.checkConfirmation = vi.fn();
anchor.getWalletBalance = vi.fn();

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58MAP = {};
B58.split('').forEach((c, i) => (B58MAP[c] = i));
function xprvToPrivKeyHex(xprvStr) {
  let n = 0n;
  for (const c of xprvStr) n = n * 58n + BigInt(B58MAP[c]);
  const hex = n.toString(16).padStart(156, '0');
  const bytes = new Uint8Array(78);
  for (let i = 0; i < 78; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return Array.from(bytes.slice(46, 78)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function freshHash(label) {
  return crypto.createHash('sha256').update(label + Math.random()).digest('hex');
}

function fakeTxid() {
  return crypto.randomBytes(32).toString('hex');
}

function mockAnchorHash(hash, txid) {
  anchor.anchorHash.mockResolvedValue({
    txid,
    network: 'testnet-10',
    walletAddress: anchor.walletAddress,
    payloadHex: anchor.buildPayloadHex(hash),
    explorerUrl: `https://explorer-tn10.kaspa.org/txs/${txid}`,
    submittedAt: new Date().toISOString(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/health', () => {
  it('reports ok, network, and wallet address', async () => {
    anchor.getWalletBalance.mockResolvedValue({ address: anchor.walletAddress, sompi: 12345 });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.network).toBe('testnet-10');
    expect(res.body.walletBalanceSompi).toBe(12345);
  });
});

describe('POST /api/anchor', () => {
  it('rejects a malformed hash', async () => {
    const res = await request(app).post('/api/anchor').send({ sha256Hash: 'not-a-hash' });
    expect(res.status).toBe(400);
    expect(anchor.anchorHash).not.toHaveBeenCalled();
  });

  it('anchors a new hash and returns the anchor record', async () => {
    const hash = freshHash('anchor-new');
    const txid = fakeTxid();
    mockAnchorHash(hash, txid);

    const res = await request(app).post('/api/anchor').send({ sha256Hash: hash, filename: 'test.pdf' });
    expect(res.status).toBe(201);
    expect(res.body.txid).toBe(txid);
    expect(res.body.alreadyAnchored).toBe(false);
    expect(anchor.anchorHash).toHaveBeenCalledTimes(1);
  });

  it('does not re-anchor an already-anchored hash', async () => {
    const hash = freshHash('anchor-dedupe');
    const txid = fakeTxid();
    mockAnchorHash(hash, txid);
    anchor.checkConfirmation.mockResolvedValue({ status: 'confirmed', confirmedAt: new Date().toISOString(), raw: {} });

    const first = await request(app).post('/api/anchor').send({ sha256Hash: hash });
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/anchor').send({ sha256Hash: hash });
    expect(second.status).toBe(200);
    expect(second.body.alreadyAnchored).toBe(true);
    expect(second.body.txid).toBe(txid);
    expect(anchor.anchorHash).toHaveBeenCalledTimes(1); // not called again for the dupe
  });
});

describe('GET /api/anchor/:txid', () => {
  it('returns 404 for an unknown txid', async () => {
    const res = await request(app).get('/api/anchor/' + fakeTxid());
    expect(res.status).toBe(404);
  });
});

describe('POST /api/verify', () => {
  it('returns matched:false when nothing matches', async () => {
    const res = await request(app).post('/api/verify').send({ sha256Hash: freshHash('verify-nomatch') });
    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(false);
  });

  it('requires at least one of sha256Hash or txid', async () => {
    const res = await request(app).post('/api/verify').send({});
    expect(res.status).toBe(400);
  });

  it('matches an anchored document by hash, and also by txid alone', async () => {
    const hash = freshHash('verify-match');
    const txid = fakeTxid();
    mockAnchorHash(hash, txid);
    anchor.checkConfirmation.mockResolvedValue({ status: 'pending', raw: null });
    await request(app).post('/api/anchor').send({ sha256Hash: hash });

    const byHash = await request(app).post('/api/verify').send({ sha256Hash: hash });
    expect(byHash.body.matched).toBe(true);
    expect(byHash.body.txid).toBe(txid);

    // Ambiguous case: a 64-hex value that is actually a txid, sent only as `txid`
    // -- must resolve via the anchors table, not the (unrelated) documents table.
    const byTxid = await request(app).post('/api/verify').send({ txid });
    expect(byTxid.body.matched).toBe(true);
    expect(byTxid.body.sha256Hash).toBe(hash);
  });
});

describe('GET /api/certificate/:id', () => {
  it('returns 404 for an unknown certificate id', async () => {
    const res = await request(app).get('/api/certificate/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('streams a valid PDF for a real anchor, respecting ?lang=', async () => {
    const hash = freshHash('cert');
    const txid = fakeTxid();
    mockAnchorHash(hash, txid);
    anchor.checkConfirmation.mockResolvedValue({ status: 'pending', raw: null });
    const created = await request(app).post('/api/anchor').send({ sha256Hash: hash });

    const res = await request(app).get(`/api/certificate/${created.body.anchorId}?lang=en`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.slice(0, 5).toString()).toBe('%PDF-');
  });
});

describe('wallet login + self-pay (§3.9 Stufe 1)', () => {
  let privateKey, address;

  beforeEach(() => {
    const mnemonic = kaspa.Mnemonic.random();
    const xprv = new kaspa.XPrv(mnemonic.toSeed(''));
    privateKey = new kaspa.PrivateKey(xprvToPrivKeyHex(xprv.derivePath("m/44'/111111'/0'/0/0").intoString('xprv')));
    address = privateKey.toKeypair().toAddress('testnet-10').toString();
  });

  async function login() {
    const challenge = await request(app).post('/api/auth/challenge').send({ kaspaAddress: address });
    const signature = kaspa.signMessage({ message: challenge.body.message, privateKey });
    const verify = await request(app).post('/api/auth/verify').send({ kaspaAddress: address, signature });
    return verify.body.token;
  }

  it('issues a token for a correctly signed challenge', async () => {
    const token = await login();
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // header.payload.signature
  });

  it('rejects verify with no prior challenge', async () => {
    const res = await request(app).post('/api/auth/verify').send({ kaspaAddress: address, signature: 'a'.repeat(128) });
    expect(res.status).toBe(401);
  });

  it('rejects a forged signature', async () => {
    await request(app).post('/api/auth/challenge').send({ kaspaAddress: address });
    const res = await request(app).post('/api/auth/verify').send({ kaspaAddress: address, signature: 'a'.repeat(128) });
    expect(res.status).toBe(401);
  });

  it('a challenge is single-use', async () => {
    const challenge = await request(app).post('/api/auth/challenge').send({ kaspaAddress: address });
    const signature = kaspa.signMessage({ message: challenge.body.message, privateKey });
    const first = await request(app).post('/api/auth/verify').send({ kaspaAddress: address, signature });
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/auth/verify').send({ kaspaAddress: address, signature });
    expect(second.status).toBe(401);
  });

  it('rejects /api/anchor/self without a bearer token', async () => {
    const res = await request(app).post('/api/anchor/self').send({ sha256Hash: freshHash('noauth'), txid: fakeTxid() });
    expect(res.status).toBe(401);
  });

  it('rejects when the on-chain payload does not match the claimed hash', async () => {
    const token = await login();
    const hash = freshHash('mismatch');
    const txid = fakeTxid();
    anchor.checkConfirmation.mockResolvedValue({
      status: 'confirmed', confirmedAt: new Date().toISOString(),
      raw: { payload: 'deadbeef', is_accepted: true },
    });
    const res = await request(app).post('/api/anchor/self').set('Authorization', `Bearer ${token}`).send({ sha256Hash: hash, txid });
    expect(res.status).toBe(422);
  });

  it('returns 404 when the txid is not found on-chain yet', async () => {
    const token = await login();
    anchor.checkConfirmation.mockResolvedValue({ status: 'pending', raw: null });
    const res = await request(app)
      .post('/api/anchor/self')
      .set('Authorization', `Bearer ${token}`)
      .send({ sha256Hash: freshHash('notfound'), txid: fakeTxid() });
    expect(res.status).toBe(404);
  });

  it('records a self-paid anchor under the authenticated address, not the platform wallet', async () => {
    const token = await login();
    const hash = freshHash('self-pay');
    const txid = fakeTxid();
    anchor.checkConfirmation.mockResolvedValue({
      status: 'confirmed', confirmedAt: new Date().toISOString(),
      raw: { payload: anchor.buildPayloadHex(hash), is_accepted: true },
    });

    const res = await request(app).post('/api/anchor/self').set('Authorization', `Bearer ${token}`).send({ sha256Hash: hash, txid });
    expect(res.status).toBe(201);
    expect(res.body.txid).toBe(txid);
    expect(res.body.status).toBe('confirmed');
    expect(anchor.anchorHash).not.toHaveBeenCalled(); // self-pay never signs anything server-side

    const verify = await request(app).post('/api/verify').send({ sha256Hash: hash });
    expect(verify.body.matched).toBe(true);
  });

  it('re-submitting the same txid with the same hash returns alreadyAnchored, not a duplicate', async () => {
    const token = await login();
    const hash = freshHash('self-pay-dupe');
    const txid = fakeTxid();
    anchor.checkConfirmation.mockResolvedValue({
      status: 'confirmed', confirmedAt: new Date().toISOString(),
      raw: { payload: anchor.buildPayloadHex(hash), is_accepted: true },
    });
    const first = await request(app).post('/api/anchor/self').set('Authorization', `Bearer ${token}`).send({ sha256Hash: hash, txid });
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/anchor/self').set('Authorization', `Bearer ${token}`).send({ sha256Hash: hash, txid });
    expect(second.status).toBe(200);
    expect(second.body.alreadyAnchored).toBe(true);
  });

  it('rejects re-submitting the same txid against a different hash (409)', async () => {
    const token = await login();
    const hash = freshHash('self-pay-conflict');
    const otherHash = freshHash('self-pay-conflict-other');
    const txid = fakeTxid();
    anchor.checkConfirmation.mockResolvedValue({
      status: 'confirmed', confirmedAt: new Date().toISOString(),
      raw: { payload: anchor.buildPayloadHex(hash), is_accepted: true },
    });
    const first = await request(app).post('/api/anchor/self').set('Authorization', `Bearer ${token}`).send({ sha256Hash: hash, txid });
    expect(first.status).toBe(201);
    const conflict = await request(app).post('/api/anchor/self').set('Authorization', `Bearer ${token}`).send({ sha256Hash: otherHash, txid });
    expect(conflict.status).toBe(409);
  });
});

describe('5xx error handling', () => {
  it('never leaks internal error details to the client', async () => {
    anchor.anchorHash.mockRejectedValue(new Error('internal SDK detail: wallet path /Users/andy/secret leaked'));
    const res = await request(app).post('/api/anchor').send({ sha256Hash: freshHash('error-leak') });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal error');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
