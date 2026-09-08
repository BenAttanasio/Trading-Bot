import dotenv from 'dotenv';
import path from 'path';
import { HARD_LIMITS } from './hard-limits';

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

const PAPER_URL_PREFIX = 'https://paper-api.alpaca.markets';

export const env = {
  // Alpaca
  ALPACA_API_KEY: requireEnv('ALPACA_API_KEY'),
  ALPACA_SECRET_KEY: requireEnv('ALPACA_SECRET_KEY'),
  ALPACA_BASE_URL: optionalEnv('ALPACA_BASE_URL', PAPER_URL_PREFIX),
  ALPACA_DATA_URL: optionalEnv('ALPACA_DATA_URL', 'https://data.alpaca.markets'),
  /** Must equal HARD_LIMITS.liveTradingConfirmation for a non-paper endpoint to start. */
  LIVE_TRADING: optionalEnv('LIVE_TRADING', ''),

  // Anthropic
  ANTHROPIC_API_KEY: requireEnv('ANTHROPIC_API_KEY'),

  // MongoDB
  MONGODB_URI: requireEnv('MONGODB_URI'),
  MONGODB_DB_NAME: optionalEnv('MONGODB_DB_NAME', 'trading_bot'),

  // Server
  PORT: parseInt(optionalEnv('PORT', '3001'), 10),
  /** Absolute path to a built dashboard (index.html + assets). Defaults to ../dashboard/dist. */
  DASHBOARD_DIST: optionalEnv('DASHBOARD_DIST', ''),
  DEMO_MODE: optionalEnv('DEMO_MODE', '') === '1',
  /** Optional shared secret for POST /api/admin/* from off-box (loopback is always allowed). */
  ADMIN_TOKEN: optionalEnv('ADMIN_TOKEN', ''),

  // Self-improvement pipeline (Pi only; blank = disabled)
  SELF_IMPROVE_REPO_DIR: optionalEnv('SELF_IMPROVE_REPO_DIR', ''),
  SELF_IMPROVE_BASE_BRANCH: optionalEnv('SELF_IMPROVE_BASE_BRANCH', 'main'),
  SELF_IMPROVE_MAX_BUDGET_USD: parseFloat(optionalEnv('SELF_IMPROVE_MAX_BUDGET_USD', '15')),
  SELF_IMPROVE_AUTO_DEPLOY: optionalEnv('SELF_IMPROVE_AUTO_DEPLOY', '1') === '1',
  /** Path of the RELEASE marker of the live release (deploy layout). */
  RELEASE_FILE: optionalEnv('RELEASE_FILE', ''),
  /** Optional Discord webhook for approvals, deploys, and nightly headlines. */
  DISCORD_WEBHOOK_URL: optionalEnv('DISCORD_WEBHOOK_URL', ''),

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
  DAILY_AI_TOKEN_BUDGET: parseInt(optionalEnv('DAILY_AI_TOKEN_BUDGET', '2000000'), 10),
  POSITION_REVIEW_COOLDOWN_MINUTES: parseInt(optionalEnv('POSITION_REVIEW_COOLDOWN_MINUTES', '90'), 10),
  SENTINEL_ESCALATION_COOLDOWN_MINUTES: parseInt(optionalEnv('SENTINEL_ESCALATION_COOLDOWN_MINUTES', '30'), 10),
  SELL_COOLDOWN_MINUTES: parseInt(optionalEnv('SELL_COOLDOWN_MINUTES', '60'), 10),
  ALPACA_API_TIMEOUT_MS: parseInt(optionalEnv('ALPACA_API_TIMEOUT_MS', '15000'), 10),
  AI_TIMEOUT_MS: parseInt(optionalEnv('AI_TIMEOUT_MS', '180000'), 10),
  /** Optional: starting equity for total P&L. If unset, captured on first boot into bot_state. */
  STARTING_EQUITY: process.env.STARTING_EQUITY ? parseFloat(process.env.STARTING_EQUITY) : null,

  // Computed
  get isPaper(): boolean {
    return this.ALPACA_BASE_URL.startsWith(PAPER_URL_PREFIX);
  },
} as const;

export function validateEnv(): void {
  // Accessing properties triggers requireEnv validation
  const _ = env;
  if (!env.isPaper && env.LIVE_TRADING !== HARD_LIMITS.liveTradingConfirmation) {
    throw new Error(
      `Refusing to start: ALPACA_BASE_URL (${env.ALPACA_BASE_URL}) is not a paper endpoint ` +
        `and LIVE_TRADING is not set to "${HARD_LIMITS.liveTradingConfirmation}".`
    );
  }
  console.log(`✓ Environment validated (${env.isPaper ? 'PAPER' : '⚠️  LIVE'} trading mode)`);
}
