// Loads the single platform anchor wallet, and anchors document hashes into Kaspa
// testnet-10/mainnet transactions by embedding them in the transaction payload field.
//
// Uses @kluster/kaspa-wasm (tracks rusty-kaspa) rather than an older bundled copy —
// confirmed during development that stale wasm builds fail every RPC call ("RPC
// response error NotFound") against the current, post-Toccata-hardfork network.
const fs = require('fs');
const crypto = require('crypto');
const kaspa = require('@kluster/kaspa-wasm');

const NETWORK = process.env.NETWORK || 'testnet-10';
const KASPA_API_URL = process.env.KASPA_API_URL || (NETWORK === 'mainnet' ? 'https://api.kaspa.org' : 'https://api-tn10.kaspa.org');
const EXPLORER_URL = NETWORK === 'mainnet' ? 'https://explorer.kaspa.org' : 'https://explorer-tn10.kaspa.org';
const KEYSTORE_PATH = process.env.ANCHOR_WALLET_KEYSTORE_PATH || './anchor-wallet.keystore.json';
const ENCRYPTION_KEY = process.env.ANCHOR_WALLET_ENCRYPTION_KEY;

// KN01 = 4-byte magic identifying a KaspaNotar anchor payload, followed by the raw
// 32-byte SHA-256 digest. Documented so any third party can parse an anchor straight
// off the chain without trusting this backend.
const PAYLOAD_MAGIC = Buffer.from('KN01', 'ascii');

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

function decryptMnemonic(keystore, passphrase) {
  const { salt, iv, authTag, ciphertext, iterations } = keystore.encryptedMnemonic;
  const key = crypto.pbkdf2Sync(passphrase, Buffer.from(salt, 'base64'), iterations, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

function loadWallet() {
  if (!ENCRYPTION_KEY) {
    console.error('FATAL: ANCHOR_WALLET_ENCRYPTION_KEY is not set. Cannot start.');
    process.exit(1);
  }
  if (!fs.existsSync(KEYSTORE_PATH)) {
    console.error(`FATAL: anchor wallet keystore not found at ${KEYSTORE_PATH}. Run "npm run wallet:generate" first.`);
    process.exit(1);
  }
  let keystore;
  try {
    keystore = JSON.parse(fs.readFileSync(KEYSTORE_PATH, 'utf8'));
  } catch (e) {
    console.error('FATAL: could not read/parse anchor wallet keystore.');
    process.exit(1);
  }
  let phrase;
  try {
    phrase = decryptMnemonic(keystore, ENCRYPTION_KEY);
  } catch (e) {
    console.error('FATAL: could not decrypt anchor wallet keystore — wrong ANCHOR_WALLET_ENCRYPTION_KEY?');
    process.exit(1);
  }
  const mnemonic = new kaspa.Mnemonic(phrase);
  const seed = mnemonic.toSeed('');
  const xprv = new kaspa.XPrv(seed);
  const derived = xprv.derivePath("m/44'/111111'/0'/0/0");
  const privateKeyHex = xprvToPrivKeyHex(derived.intoString('xprv'));
  const privateKey = new kaspa.PrivateKey(privateKeyHex);
  const address = privateKey.toKeypair().toAddress(NETWORK).toString();

  if (keystore.network !== NETWORK) {
    console.error(`FATAL: keystore was generated for network "${keystore.network}" but NETWORK="${NETWORK}".`);
    process.exit(1);
  }
  if (address !== keystore.address) {
    console.error('FATAL: derived address does not match keystore address — corrupted keystore?');
    process.exit(1);
  }

  return { privateKey, address };
}

const wallet = loadWallet();

let rpc = null;
let rpcConnecting = null;
async function getRpc() {
  if (rpc && rpc.isConnected) return rpc;
  if (!rpc) {
    const resolver = new kaspa.Resolver();
    rpc = new kaspa.RpcClient({ resolver, networkId: NETWORK, encoding: kaspa.Encoding.Borsh });
  }
  if (!rpcConnecting) {
    rpcConnecting = rpc.connect().finally(() => {
      rpcConnecting = null;
    });
  }
  await rpcConnecting;
  return rpc;
}

// Serializes all tx building/signing/submission so concurrent anchor requests never
// race for the same UTXOs. Fresh UTXOs are fetched at the start of every job.
let queue = Promise.resolve();
function enqueue(fn) {
  const result = queue.then(fn, fn);
  queue = result.then(
    () => {},
    () => {}
  );
  return result;
}

function buildPayloadHex(sha256HashHex) {
  const hashBytes = Buffer.from(sha256HashHex, 'hex');
  if (hashBytes.length !== 32) throw new Error('sha256Hash must be a 32-byte hex string');
  return Buffer.concat([PAYLOAD_MAGIC, hashBytes]).toString('hex');
}

async function anchorHash(sha256HashHex) {
  return enqueue(async () => {
    const client = await getRpc();
    const payloadHex = buildPayloadHex(sha256HashHex);

    const utxoResp = await client.getUtxosByAddresses({ addresses: [wallet.address] });
    const entries = utxoResp.entries || utxoResp;
    if (!entries || !entries.length) {
      throw new Error(`Anchor wallet ${wallet.address} has no UTXOs — fund it before anchoring.`);
    }

    const { transactions } = await kaspa.createTransactions({
      entries,
      outputs: [],
      changeAddress: wallet.address,
      priorityFee: 0n,
      payload: payloadHex,
      networkId: NETWORK,
      isToccataActive: true,
    });

    const ptx = transactions[0];
    ptx.sign([wallet.privateKey]);
    const txid = await ptx.submit(client);

    // The wallet holds a single UTXO chain: until this transaction's change output
    // is reflected in the node's UTXO set, the *next* queued anchor would fetch the
    // same now-spent UTXO and get rejected as a double-spend (confirmed via a real
    // "already spent by transaction ... in the mempool" error during testing).
    // Waiting for confirmation here — fast on Kaspa, ~1s observed on testnet-10 —
    // fully avoids the race for the documented anchor volume (~1 every 30s average).
    await waitForOwnConfirmation(txid);

    return {
      txid,
      network: NETWORK,
      walletAddress: wallet.address,
      payloadHex,
      explorerUrl: `${EXPLORER_URL}/txs/${txid}`,
      submittedAt: new Date().toISOString(),
    };
  });
}

async function waitForOwnConfirmation(txid, { timeoutMs = 15000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status } = await checkConfirmation(txid).catch(() => ({ status: 'pending' }));
    if (status === 'confirmed') return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false; // proceed anyway — worst case is the same pre-existing race, not a new failure mode
}

// Confirmation status is checked via the public REST indexer rather than the wRPC
// connection — stateless, doesn't require holding an RPC round-trip open, and is
// exactly what an independent third party would use to verify an anchor themselves.
async function checkConfirmation(txid) {
  const res = await fetch(`${KASPA_API_URL}/transactions/${txid}`);
  if (res.status === 404) return { status: 'pending', raw: null };
  if (!res.ok) throw new Error(`Kaspa API error ${res.status} checking ${txid}`);
  const tx = await res.json();
  const status = tx.is_accepted ? 'confirmed' : 'pending';
  return {
    status,
    confirmedAt: tx.is_accepted && tx.accepting_block_time ? new Date(tx.accepting_block_time).toISOString() : null,
    raw: tx,
  };
}

async function getWalletBalance() {
  const res = await fetch(`${KASPA_API_URL}/addresses/${encodeURIComponent(wallet.address)}/balance`);
  if (!res.ok) throw new Error(`Kaspa API error ${res.status} checking wallet balance`);
  const data = await res.json();
  return { address: wallet.address, sompi: data.balance, network: NETWORK };
}

module.exports = {
  NETWORK,
  EXPLORER_URL,
  walletAddress: wallet.address,
  anchorHash,
  checkConfirmation,
  getWalletBalance,
  buildPayloadHex,
};
