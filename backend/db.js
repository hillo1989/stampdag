// SQLite driver (default). Set DB_DRIVER=postgres to use db-pg.js instead — both
// export the same documents/anchors API so server.js doesn't need to know which one
// is active.
const crypto = require('crypto');

if (process.env.DB_DRIVER === 'postgres') {
  module.exports = require('./db-pg.js');
  return;
}

const Database = require('better-sqlite3');

const DB_PATH = process.env.KASPANOTAR_DB_PATH || './kaspanotar.db';
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id            TEXT PRIMARY KEY,
    sha256_hash   TEXT NOT NULL UNIQUE,
    filename      TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS anchors (
    id                  TEXT PRIMARY KEY,
    document_id         TEXT NOT NULL REFERENCES documents(id),
    kaspa_txid          TEXT NOT NULL UNIQUE,
    network             TEXT NOT NULL,
    wallet_address      TEXT NOT NULL,
    payload_hex         TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',
    confirmations_info  TEXT,
    submitted_at        TEXT NOT NULL,
    confirmed_at        TEXT,
    last_checked_at     TEXT,
    created_at          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_anchors_document ON anchors(document_id);
  CREATE INDEX IF NOT EXISTS idx_anchors_status ON anchors(status);
`);

function documentFromRow(r) {
  if (!r) return null;
  return { id: r.id, sha256Hash: r.sha256_hash, filename: r.filename, createdAt: r.created_at };
}

function anchorFromRow(r) {
  if (!r) return null;
  return {
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
}

const stmts = {
  insertDocument: db.prepare('INSERT INTO documents (id, sha256_hash, filename, created_at) VALUES (?, ?, ?, ?)'),
  findDocumentByHash: db.prepare('SELECT * FROM documents WHERE sha256_hash = ?'),
  findDocumentById: db.prepare('SELECT * FROM documents WHERE id = ?'),

  insertAnchor: db.prepare(`
    INSERT INTO anchors (id, document_id, kaspa_txid, network, wallet_address, payload_hex, status, submitted_at, created_at)
    VALUES (@id, @documentId, @txid, @network, @walletAddress, @payloadHex, @status, @submittedAt, @createdAt)
  `),
  findAnchorByTxid: db.prepare('SELECT * FROM anchors WHERE kaspa_txid = ?'),
  findAnchorById: db.prepare('SELECT * FROM anchors WHERE id = ?'),
  findAnchorsByDocumentId: db.prepare('SELECT * FROM anchors WHERE document_id = ? ORDER BY created_at DESC'),
  findPendingAnchors: db.prepare("SELECT * FROM anchors WHERE status = 'pending'"),
  updateAnchorStatus: db.prepare(`
    UPDATE anchors SET status = @status, confirmations_info = @confirmationsInfo,
      confirmed_at = @confirmedAt, last_checked_at = @lastCheckedAt WHERE kaspa_txid = @txid
  `),
};

const documents = {
  findByHash(sha256Hash) {
    return documentFromRow(stmts.findDocumentByHash.get(sha256Hash));
  },
  findById(id) {
    return documentFromRow(stmts.findDocumentById.get(id));
  },
  create({ sha256Hash, filename }) {
    const row = { id: crypto.randomUUID(), sha256Hash, filename: filename || null, createdAt: new Date().toISOString() };
    stmts.insertDocument.run(row.id, row.sha256Hash, row.filename, row.createdAt);
    return documentFromRow(stmts.findDocumentById.get(row.id));
  },
};

const anchors = {
  findByTxid(txid) {
    return anchorFromRow(stmts.findAnchorByTxid.get(txid));
  },
  findById(id) {
    return anchorFromRow(stmts.findAnchorById.get(id));
  },
  findByDocumentId(documentId) {
    return stmts.findAnchorsByDocumentId.all(documentId).map(anchorFromRow);
  },
  findPending() {
    return stmts.findPendingAnchors.all().map(anchorFromRow);
  },
  create({ documentId, txid, network, walletAddress, payloadHex }) {
    const row = {
      id: crypto.randomUUID(),
      documentId,
      txid,
      network,
      walletAddress,
      payloadHex,
      status: 'pending',
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    stmts.insertAnchor.run(row);
    return anchorFromRow(stmts.findAnchorById.get(row.id));
  },
  updateStatus(txid, { status, confirmationsInfo, confirmedAt, lastCheckedAt }) {
    stmts.updateAnchorStatus.run({
      txid,
      status,
      confirmationsInfo: confirmationsInfo ? JSON.stringify(confirmationsInfo) : null,
      confirmedAt: confirmedAt || null,
      lastCheckedAt: lastCheckedAt || new Date().toISOString(),
    });
    return anchorFromRow(stmts.findAnchorByTxid.get(txid));
  },
};

function ping() {
  db.prepare('SELECT 1').get();
  return true;
}

module.exports = { documents, anchors, ping, raw: db };
