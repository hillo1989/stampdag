// Wallet-ownership proof for "Sign-in with Wallet" logins (Lastenheft §3.9 Stufe 1).
// Delegates entirely to @kluster/kaspa-wasm's own signMessage/verifyMessage rather
// than hand-rolling bech32m decoding + Schnorr verification (as KasPay's sibling
// kaspa-crypto.js does) — Kasware itself signs via this exact same SDK
// (kasware-wallet/extension: simple-keyring.ts calls kaspaWasm.signMessage), so using
// the SDK's own verifyMessage guarantees byte-for-byte compatibility with whatever a
// connected Kasware wallet actually produces. Round-trip-tested against a generated
// testnet-10 keypair before wiring this in: sign -> verify(correct message) === true,
// verify(tampered message) === false.
const kaspa = require('@kluster/kaspa-wasm');

function publicKeyHexFromAddress(addressStr) {
  const address = new kaspa.Address(addressStr);
  return kaspa.XOnlyPublicKey.fromAddress(address).toString();
}

function verifyMessage(message, signatureHex, kaspaAddress) {
  try {
    const publicKey = publicKeyHexFromAddress(kaspaAddress);
    return kaspa.verifyMessage({ message, signature: signatureHex, publicKey });
  } catch (e) {
    return false;
  }
}

module.exports = { verifyMessage, publicKeyHexFromAddress };
