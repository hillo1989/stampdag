`test-wallet.keystore.json` is a throwaway testnet-10 keystore generated only for
the test suite (`ANCHOR_WALLET_ENCRYPTION_KEY=test-only-fixture-key-not-for-real-funds`,
hardcoded in `tests/setup.js`). It is intentionally never funded and never used
against a live network -- tests mock every function in `kaspa-anchor.js` that would
touch the chain. Safe to commit; not a real secret. Never point this fixture (or its
key) at a funded wallet.
