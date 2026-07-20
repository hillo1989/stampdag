// Runs before any test file. Pins the whole process to an isolated, throwaway
// testnet-10 fixture wallet -- completely decoupled from the real .env -- so tests
// can never load real wallet material regardless of what's currently configured for
// local dev/production. kaspa-anchor.js reads these at module-require time, so they
// must be set before any test imports server.js or kaspa-anchor.js.
process.env.NODE_ENV = 'test';
process.env.NETWORK = 'testnet-10';
process.env.KASPA_API_URL = 'https://api-tn10.kaspa.org';
process.env.ANCHOR_WALLET_KEYSTORE_PATH = require('path').join(__dirname, 'fixtures', 'test-wallet.keystore.json');
process.env.ANCHOR_WALLET_ENCRYPTION_KEY = 'test-only-fixture-key-not-for-real-funds';
process.env.JWT_SECRET = 'test-only-jwt-secret-do-not-use-in-production';
process.env.KASPANOTAR_DB_PATH = ':memory:';
process.env.CORS_ORIGINS = 'http://localhost:3210';
process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_GLOBAL_MAX = '100000'; // don't let rate limiting interfere between test cases
process.env.RATE_LIMIT_ANCHOR_MAX = '100000';
process.env.RATE_LIMIT_SELF_ANCHOR_MAX = '100000';
process.env.RATE_LIMIT_AUTH_MAX = '100000';
