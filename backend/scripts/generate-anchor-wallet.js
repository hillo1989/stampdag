// One-time setup: generates a new Kaspa wallet to be used as KaspaNotar's single
// platform anchor wallet, and stores its mnemonic encrypted at rest (AES-256-GCM).
// Run manually: node scripts/generate-anchor-wallet.js [--network testnet-10] [--force]
//
// The wallet address is printed so the operator can fund it (testnet-10: use a
// public faucet; mainnet: send real KAS). ANCHOR_WALLET_ENCRYPTION_KEY must be set
// in the environment — it is never written to disk.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const kaspa = require('@kluster/kaspa-wasm');

const args = process.argv.slice(2);
const force = args.includes('--force');
const networkArgIdx = args.indexOf('--network');
const NETWORK = networkArgIdx !== -1 ? args[networkArgIdx + 1] : (process.env.NETWORK || 'testnet-10');

const KEYSTORE_PATH = process.env.ANCHOR_WALLET_KEYSTORE_PATH || path.join(__dirname, '..', 'anchor-wallet.keystore.json');
const ENCRYPTION_KEY = process.env.ANCHOR_WALLET_ENCRYPTION_KEY;

const PBKDF2_ITERATIONS = 200000; // same parameters as KasPay's client-side mnemonic encryption

function deriveWallet(network) {
  const mnemonic = kaspa.Mnemonic.random();
  const seed = mnemonic.toSeed('');
  const xprv = new kaspa.XPrv(seed);
  const derived = xprv.derivePath("m/44'/111111'/0'/0/0");
  const privateKeyHex = xprvToPrivKeyHex(derived.intoString('xprv'));
  const privateKey = new kaspa.PrivateKey(privateKeyHex);
  const address = privateKey.toKeypair().toAddress(network).toString();
  return { phrase: mnemonic.phrase, address };
}

// Ported from KasPay app/index.html:4496 — decodes a base58check xprv string down
// to the raw 32-byte private key hex (bytes 46..78 of the 78-byte BIP32 payload).
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

function encryptMnemonic(phrase, passphrase) {
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(phrase, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    kdf: 'pbkdf2-sha256',
    iterations: PBKDF2_ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function main() {
  if (!ENCRYPTION_KEY) {
    console.error('ANCHOR_WALLET_ENCRYPTION_KEY is not set. Set it to a strong passphrase before running this script.');
    process.exit(1);
  }
  if (fs.existsSync(KEYSTORE_PATH) && !force) {
    console.error(`Keystore already exists at ${KEYSTORE_PATH}. Refusing to overwrite. Pass --force to override.`);
    process.exit(1);
  }

  const { phrase, address } = deriveWallet(NETWORK);
  const encrypted = encryptMnemonic(phrase, ENCRYPTION_KEY);

  const keystore = { version: 1, network: NETWORK, address, createdAt: new Date().toISOString(), encryptedMnemonic: encrypted };
  fs.writeFileSync(KEYSTORE_PATH, JSON.stringify(keystore, null, 2), { mode: 0o600 });

  console.log(`Anchor wallet created for network "${NETWORK}".`);
  console.log(`Address: ${address}`);
  console.log(`Keystore written to: ${KEYSTORE_PATH}`);
  console.log('Fund this address before starting the server (testnet-10: use a public faucet; mainnet: send real KAS).');
}

main();
