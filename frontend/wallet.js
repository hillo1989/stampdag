// StampDAG — Kasware wallet integration (login + self-pay anchoring).
// window.kasware API confirmed via docs.kasware.xyz: requestAccounts(), signMessage,
// sendKaspa(toAddress, sompi, {payload}) where payload is hex-encoded and embedded
// in the transaction -- the exact mechanism this app's anchoring depends on.
// Structured as a small adapter (StampWallet.*) so a second wallet provider could be
// added later without touching index.html's anchor-flow branching.
(function () {
  'use strict';

  const SESSION_KEY = 'stampdag_wallet_session'; // { token, kaspaAddress, expiresAt }
  const PAYLOAD_MAGIC_HEX = '4b4e3031'; // "KN01", must match backend/kaspa-anchor.js
  // Self-pay anchors are wallet-to-self transfers whose only purpose is carrying the
  // payload. Kaspa's KIP-9 storage-mass rule rejects transactions ("Storage mass
  // exceeds maximum") when an output is small relative to the UTXO(s) it spends --
  // confirmed empirically against real testnet-10: sending 1,000-100,000 sompi from a
  // 200,000,000-sompi UTXO failed with exactly this error, while 10,000,000+ sompi
  // (>=5% of the input) succeeded. 0.2 KAS is comfortably above that observed
  // threshold for typical balances while still being a negligible amount -- if a
  // wallet's UTXO layout is unusual enough to still trip the limit, that surfaces as
  // a clear error rather than a silent failure.
  const SELF_ANCHOR_SOMPI = 20000000; // 0.2 KAS

  function hasKasware() {
    return typeof window.kasware !== 'undefined';
  }

  function loadSession() {
    try {
      const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!raw || !raw.token || !raw.expiresAt || Date.now() > raw.expiresAt) return null;
      return raw;
    } catch (e) {
      return null;
    }
  }

  function saveSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function isLoggedIn() {
    return !!loadSession();
  }

  async function apiCall(path, opts) {
    opts = opts || {};
    const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function login() {
    if (!hasKasware()) throw new Error('Kasware nicht gefunden');
    const accounts = await window.kasware.requestAccounts();
    const kaspaAddress = Array.isArray(accounts) ? accounts[0] : accounts;
    if (!kaspaAddress) throw new Error('Keine Wallet-Adresse erhalten');

    const challenge = await apiCall('/api/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({ kaspaAddress }),
    });
    const signature = await window.kasware.signMessage(challenge.message);
    const verified = await apiCall('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ kaspaAddress, signature }),
    });

    const session = {
      token: verified.token,
      kaspaAddress: verified.kaspaAddress,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
    saveSession(session);
    return session;
  }

  function logout() {
    clearSession(); // client-side only -- the JWT itself carries no server-side session to revoke
  }

  function buildPayloadHex(sha256Hash) {
    if (!/^[a-f0-9]{64}$/i.test(sha256Hash)) throw new Error('sha256Hash must be a 64-character hex string');
    return PAYLOAD_MAGIC_HEX + sha256Hash.toLowerCase();
  }

  async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Sends the self-paid anchor transaction via Kasware, then records it with the
  // backend -- retrying briefly on 404 since the public indexer can lag a couple
  // seconds behind broadcast.
  async function anchorSelf(sha256Hash, filename) {
    const session = loadSession();
    if (!session) throw new Error('Nicht eingeloggt');

    const payload = buildPayloadHex(sha256Hash);
    const sendResult = await window.kasware.sendKaspa(session.kaspaAddress, SELF_ANCHOR_SOMPI, { payload });
    const txid = typeof sendResult === 'string' ? sendResult : sendResult && (sendResult.txid || sendResult.id);
    if (!txid) throw new Error('Keine Transaktions-ID von der Wallet erhalten');

    let lastErr;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return await apiCall('/api/anchor/self', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.token}` },
          body: JSON.stringify({ sha256Hash, filename, txid }),
        });
      } catch (e) {
        lastErr = e;
        if (!/HTTP 404/.test(e.message)) throw e;
        await sleep(2000);
      }
    }
    throw lastErr;
  }

  window.StampWallet = {
    hasKasware,
    isLoggedIn,
    getSession: loadSession,
    login,
    logout,
    anchorSelf,
    buildPayloadHex,
  };
})();
