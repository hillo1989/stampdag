// Unit tests for the Schnorr signature verification used by wallet-login
// (§3.9 Stufe 1). Generates its own ephemeral keypair via the SDK -- offline, no
// network, no dependency on the fixture wallet.
import { describe, it, expect, beforeAll } from 'vitest';
import kaspaCrypto from '../kaspa-crypto.js';
import kaspa from '@kluster/kaspa-wasm';

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

describe('kaspa-crypto verifyMessage', () => {
  let privateKey;
  let address;

  beforeAll(() => {
    const mnemonic = kaspa.Mnemonic.random();
    const xprv = new kaspa.XPrv(mnemonic.toSeed(''));
    const derived = xprv.derivePath("m/44'/111111'/0'/0/0");
    privateKey = new kaspa.PrivateKey(xprvToPrivKeyHex(derived.intoString('xprv')));
    address = privateKey.toKeypair().toAddress('testnet-10').toString();
  });

  it('accepts a genuine signature over the exact signed message', () => {
    const message = 'stampdag-login|' + address + '|somenonce|1234567890';
    const signature = kaspa.signMessage({ message, privateKey });
    expect(kaspaCrypto.verifyMessage(message, signature, address)).toBe(true);
  });

  it('rejects the same signature over a different (tampered) message', () => {
    const message = 'stampdag-login|' + address + '|somenonce|1234567890';
    const signature = kaspa.signMessage({ message, privateKey });
    expect(kaspaCrypto.verifyMessage(message + 'x', signature, address)).toBe(false);
  });

  it('rejects a signature from a different wallet claiming this address', () => {
    const message = 'stampdag-login|' + address + '|somenonce|1234567890';
    const otherMnemonic = kaspa.Mnemonic.random();
    const otherXprv = new kaspa.XPrv(otherMnemonic.toSeed(''));
    const otherPrivateKey = new kaspa.PrivateKey(
      xprvToPrivKeyHex(otherXprv.derivePath("m/44'/111111'/0'/0/0").intoString('xprv'))
    );
    const wrongSignature = kaspa.signMessage({ message, privateKey: otherPrivateKey });
    expect(kaspaCrypto.verifyMessage(message, wrongSignature, address)).toBe(false);
  });

  it('fails closed on a malformed address instead of throwing', () => {
    expect(() => kaspaCrypto.verifyMessage('msg', 'ab'.repeat(64), 'not-a-real-address')).not.toThrow();
    expect(kaspaCrypto.verifyMessage('msg', 'ab'.repeat(64), 'not-a-real-address')).toBe(false);
  });

  it('fails closed on a malformed signature instead of throwing', () => {
    expect(() => kaspaCrypto.verifyMessage('msg', 'not-hex!!', address)).not.toThrow();
    expect(kaspaCrypto.verifyMessage('msg', 'not-hex!!', address)).toBe(false);
  });
});
