import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export const env = {
  // Alpaca
  ALPACA_API_KEY: requireEnv('ALPACA_API_KEY'),
  ALPACA_SECRET_KEY: requireEnv('ALPACA_SECRET_KEY'),
  ALPACA_BASE_URL: optionalEnv('ALPACA_BASE_URL', 'https://paper-api.alpaca.markets'),
  ALPACA_DATA_URL: optionalEnv('ALPACA_DATA_URL', 'https://data.alpaca.markets'),

  // Anthropic
  ANTHROPIC_API_KEY: requireEnv('ANTHROPIC_API_KEY'),

  // MongoDB
  MONGODB_URI: requireEnv('MONGODB_URI'),
  MONGODB_DB_NAME: optionalEnv('MONGODB_DB_NAME', 'trading_bot'),

  // Server
  PORT: parseInt(optionalEnv('PORT', '3001'), 10),
  DASHBOARD_PORT: parseInt(optionalEnv('DASHBOARD_PORT', '5173'), 10),

  // Trading Config
  MAX_POSITION_SIZE_DOLLARS: parseFloat(optionalEnv('MAX_POSITION_SIZE_DOLLARS', '50')),
  MAX_PORTFOLIO_EXPOSURE: parseFloat(optionalEnv('MAX_PORTFOLIO_EXPOSURE', '500')),
  MAX_DAILY_TRADES: parseInt(optionalEnv('MAX_DAILY_TRADES', '10'), 10),
  MAX_DAILY_LOSS_PERCENT: parseFloat(optionalEnv('MAX_DAILY_LOSS_PERCENT', '3')),
  COOLDOWN_MINUTES: parseInt(optionalEnv('COOLDOWN_MINUTES', '120'), 10),
  REVENGE_TRADE_COOLDOWN_HOURS: parseInt(optionalEnv('REVENGE_TRADE_COOLDOWN_HOURS', '24'), 10),
  MAX_HOLD_DAYS_BEFORE_REVIEW: parseInt(optionalEnv('MAX_HOLD_DAYS_BEFORE_REVIEW', '30'), 10),
  SENTINEL_POLL_INTERVAL_SECONDS: parseInt(optionalEnv('SENTINEL_POLL_INTERVAL_SECONDS', '60'), 10),
  INTRADAY_PULSE_INTERVAL_MINUTES: parseInt(optionalEnv('INTRADAY_PULSE_INTERVAL_MINUTES', '30'), 10),

  // Computed
  get isPaper(): boolean {
    return this.ALPACA_BASE_URL.includes('paper');
  },
} as const;

export function validateEnv(): void {
  // Accessing properties triggers requireEnv validation
  const _ = env;
  console.log(`✓ Environment validated (${env.isPaper ? 'PAPER' : 'LIVE'} trading mode)`);
}
