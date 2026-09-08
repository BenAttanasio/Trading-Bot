// Provide the required env vars so src/config/env.ts can load in tests
// without a real .env. Real values from a local .env (if present) take precedence
// because dotenv never overrides existing variables and these are set first only
// when missing.
process.env.ALPACA_API_KEY ??= 'test-key';
process.env.ALPACA_SECRET_KEY ??= 'test-secret';
process.env.ANTHROPIC_API_KEY ??= 'test-anthropic';
process.env.MONGODB_URI ??= 'mongodb://localhost:27017';
process.env.ALPACA_BASE_URL ??= 'https://paper-api.alpaca.markets';
