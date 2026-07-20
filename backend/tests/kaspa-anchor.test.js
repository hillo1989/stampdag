// Unit tests for kaspa-anchor.js's pure logic. Importing this module loads the
// throwaway test fixture wallet (tests/setup.js) -- offline, no network involved.
import { describe, it, expect } from 'vitest';
import anchor from '../kaspa-anchor.js';
import crypto from 'crypto';

describe('buildPayloadHex', () => {
  it('produces 4-byte "KN01" magic + the raw 32-byte hash, hex-encoded', () => {
    const hash = crypto.createHash('sha256').update('test document').digest('hex');
    const payload = anchor.buildPayloadHex(hash);
    expect(payload).toBe('4b4e3031' + hash);
    expect(payload).toHaveLength(72); // (4 + 32) bytes * 2 hex chars
  });

  it('is deterministic for the same input', () => {
    const hash = crypto.createHash('sha256').update('same content').digest('hex');
    expect(anchor.buildPayloadHex(hash)).toBe(anchor.buildPayloadHex(hash));
  });

  it('produces different payloads for different hashes', () => {
    const a = crypto.createHash('sha256').update('document A').digest('hex');
    const b = crypto.createHash('sha256').update('document B').digest('hex');
    expect(anchor.buildPayloadHex(a)).not.toBe(anchor.buildPayloadHex(b));
  });

  it('rejects a hash that is not 32 bytes', () => {
    expect(() => anchor.buildPayloadHex('deadbeef')).toThrow();
    expect(() => anchor.buildPayloadHex('a'.repeat(63))).toThrow();
  });
});

describe('module identity', () => {
  it('exposes the fixture wallet address and testnet-10 network', () => {
    expect(anchor.NETWORK).toBe('testnet-10');
    expect(anchor.walletAddress).toMatch(/^kaspatest:/);
    expect(anchor.EXPLORER_URL).toContain('explorer-tn10.kaspa.org');
  });
});
