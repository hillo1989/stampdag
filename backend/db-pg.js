// Postgres driver (opt-in via DB_DRIVER=postgres). Mirrors db.js's documents/anchors
// API exactly, but async — server.js always `await`s db calls so it works transparently
// with either driver.
const crypto = require('crypto');
const { Pool } = require('pg');

const CONNECTION_STRING = process.env.DATABASE_URL;
if (!CONNECTION_STRING) {
  throw new Error('DATABASE_URL must be set when DB_DRIVER=postgres');
}

const pool = new Pool({
  connectionString: CONNECTION_STRING,
  min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
  max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DB_SSL === '1' ? { rejectUnauthorized: false } : false,
});

async function query(sql, params = []) {
  const start = Date.now();
  try {
    const res = await pool.query(sql, params);
    const dur = Date.now() - start;
    if (dur > 500) console.warn(`[db-pg] slow query (${dur}ms):`, sql.slice(0, 100));
    return res;
  } catch (e) {
    console.error('[db-pg] query failed:', sql.slice(0, 100), e.message);
    throw e;
  }
}

const schemaReady = (async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS documents (
      id            TEXT PRIMARY KEY,
      sha256_hash   TEXT NOT NULL UNIQUE,
      filename      TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS anchors (
      id                  TEXT PRIMARY KEY,
      document_id         TEXT NOT NULL REFERENCES documents(id),
      kaspa_txid          TEXT NOT NULL UNIQUE,
      network             TEXT NOT NULL,
      wallet_address      TEXT NOT NULL,
      payload_hex         TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending',
      confirmations_info  TEXT,
      submitted_at        TIMESTAMPTZ NOT NULL,
      confirmed_at        TIMESTAMPTZ,
      last_checked_at     TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_anchors_document ON anchors(document_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_anchors_status ON anchors(status)');
})();

const documentFromRow = (r) => r && { id: r.id, sha256Hash: r.sha256_hash, filename: r.filename, createdAt: r.created_at };
const anchorFromRow = (r) =>
  r && {
    id: r.id,
    documentId: r.document_id,
    txid: r.kaspa_txid,
    network: r.network,
    walletAddress: r.wallet_address,
    payloadHex: r.payload_hex,
    status: r.status,
    confirmationsInfo: r.confirmations_info,
    submittedAt: r.submitted_at,
    confirmedAt: r.confirmed_at,
    lastCheckedAt: r.last_checked_at,
    createdAt: r.created_at,
  };

const documents = {
  async findByHash(sha256Hash) {
    await schemaReady;
    const res = await query('SELECT * FROM documents WHERE sha256_hash = $1', [sha256Hash]);
    return documentFromRow(res.rows[0]);
  },
  async findById(id) {
    await schemaReady;
    const res = await query('SELECT * FROM documents WHERE id = $1', [id]);
    return documentFromRow(res.rows[0]);
  },
  async create({ sha256Hash, filename }) {
    await schemaReady;
    const id = crypto.randomUUID();
    await query('INSERT INTO documents (id, sha256_hash, filename, created_at) VALUES ($1, $2, $3, NOW())', [id, sha256Hash, filename || null]);
    return documents.findById(id);
  },
};

const anchors = {
  async findByTxid(txid) {
    await schemaReady;
    const res = await query('SELECT * FROM anchors WHERE kaspa_txid = $1', [txid]);
    return anchorFromRow(res.rows[0]);
  },
  async findById(id) {
    await schemaReady;
    const res = await query('SELECT * FROM anchors WHERE id = $1', [id]);
    return anchorFromRow(res.rows[0]);
  },
  async findByDocumentId(documentId) {
    await schemaReady;
    const res = await query('SELECT * FROM anchors WHERE document_id = $1 ORDER BY created_at DESC', [documentId]);
    return res.rows.map(anchorFromRow);
  },
  async findPending() {
    await schemaReady;
    const res = await query("SELECT * FROM anchors WHERE status = 'pending'");
    return res.rows.map(anchorFromRow);
  },
  async stats() {
    await schemaReady;
    const res = await query("SELECT COUNT(*) AS total, MAX(confirmed_at) AS last_confirmed_at FROM anchors WHERE status = 'confirmed'");
    return { total: parseInt(res.rows[0].total, 10), lastConfirmedAt: res.rows[0].last_confirmed_at || null };
  },
  async create({ documentId, txid, network, walletAddress, payloadHex }) {
    await schemaReady;
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO anchors (id, document_id, kaspa_txid, network, wallet_address, payload_hex, status, submitted_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), NOW())`,
      [id, documentId, txid, network, walletAddress, payloadHex]
    );
    return anchors.findById(id);
  },
  async updateStatus(txid, { status, confirmationsInfo, confirmedAt, lastCheckedAt }) {
    await schemaReady;
    await query(
      `UPDATE anchors SET status = $2, confirmations_info = $3, confirmed_at = $4, last_checked_at = $5 WHERE kaspa_txid = $1`,
      [txid, status, confirmationsInfo ? JSON.stringify(confirmationsInfo) : null, confirmedAt || null, lastCheckedAt || new Date().toISOString()]
    );
    return anchors.findByTxid(txid);
  },
};

async function ping() {
  await schemaReady;
  await query('SELECT 1');
  return true;
}

module.exports = { documents, anchors, ping };
