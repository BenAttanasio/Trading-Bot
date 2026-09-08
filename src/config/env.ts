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
  /**
   * Model per tier. Defaults keep Opus out of the loop entirely: Sonnet 5 does the
   * ranking, decisions, reviews and reflections; Haiku 4.5 does triage. Set
   * AI_DEEP_MODEL=claude-opus-5 to opt back in for the deep tier.
   */
  AI_BUDGET_MODEL: optionalEnv('AI_BUDGET_MODEL', 'claude-haiku-4-5'),
  AI_FAST_MODEL: optionalEnv('AI_FAST_MODEL', 'claude-sonnet-5'),
  AI_DEEP_MODEL: optionalEnv('AI_DEEP_MODEL', 'claude-sonnet-5'),

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
  /** How many top-conviction buys the morning cycle may place. */
  MORNING_MAX_BUYS: parseInt(optionalEnv('MORNING_MAX_BUYS', '8'), 10),
  /** Below this % of equity invested, the morning cycle runs in "initial deployment" mode (conviction bar 5 instead of 6). */
  INITIAL_DEPLOYMENT_BELOW_PERCENT: parseFloat(optionalEnv('INITIAL_DEPLOYMENT_BELOW_PERCENT', '10')),
  /** % of equity risked between entry and stop per trade (sizing = risk / stop distance, capped by MAX_POSITION_SIZE_DOLLARS). */
  RISK_PER_TRADE_PERCENT: parseFloat(optionalEnv('RISK_PER_TRADE_PERCENT', '0.5')),
  /** How many short entries the morning cycle may open (only when ENABLE_SHORTS=1). */
  MORNING_MAX_SHORTS: parseInt(optionalEnv('MORNING_MAX_SHORTS', '2'), 10),
  /** 1 = the ranking may propose shorts and the risk manager accepts open_short intents. */
  ENABLE_SHORTS: optionalEnv('ENABLE_SHORTS', '0') === '1',
  /** 1 = widen the morning universe with Alpaca's movers + most-actives screener. */
  UNIVERSE_SCREENER: optionalEnv('UNIVERSE_SCREENER', '1') === '1',
  /** Cap on symbols sent to the ranking call (watchlist first, screener fills the rest). */
  UNIVERSE_MAX_CANDIDATES: parseInt(optionalEnv('UNIVERSE_MAX_CANDIDATES', '30'), 10),
  /** Screener candidates below this price are dropped (penny names, warrants). */
  UNIVERSE_MIN_PRICE: parseFloat(optionalEnv('UNIVERSE_MIN_PRICE', '5')),
  /** Screener candidates whose price × today's volume is below this are dropped (illiquid microcaps). */
  UNIVERSE_MIN_DOLLAR_VOLUME: parseFloat(optionalEnv('UNIVERSE_MIN_DOLLAR_VOLUME', '25000000')),
  /**
   * SEC EDGAR asks for a descriptive User-Agent (ideally "Name contact@email"). The
   * default is a generic descriptive string; set EDGAR_USER_AGENT=off to disable the
   * 8-K / 10-Q filings feed in the ranking.
   */
  EDGAR_USER_AGENT: (() => {
    const v = optionalEnv('EDGAR_USER_AGENT', 'ai-trader/1.0 (autonomous paper-trading research bot)');
    return v.trim().toLowerCase() === 'off' ? '' : v;
  })(),
  /** Minimum scored predictions before the weekly review may tune params or file change requests. */
  MIN_SCORED_FOR_TUNING: parseInt(optionalEnv('MIN_SCORED_FOR_TUNING', '30'), 10),
  /** 1 = code-enforced stop / target / time-stop guard runs every sentinel tick. */
  STOP_GUARD_ENABLED: optionalEnv('STOP_GUARD_ENABLED', '1') === '1',
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
