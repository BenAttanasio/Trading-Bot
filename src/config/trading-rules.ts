import { env } from './env';

export const TRADING_RULES = {
  // Position limits
  maxPositionSizeDollars: env.MAX_POSITION_SIZE_DOLLARS,
  maxPortfolioExposure: env.MAX_PORTFOLIO_EXPOSURE,

  // Daily limits
  maxDailyTrades: env.MAX_DAILY_TRADES,
  maxDailyLossPercent: env.MAX_DAILY_LOSS_PERCENT,

  // Cooldowns
  cooldownMinutes: env.COOLDOWN_MINUTES,
  revengeTradeCooldownHours: env.REVENGE_TRADE_COOLDOWN_HOURS,

  // Position management
  maxHoldDaysBeforeReview: env.MAX_HOLD_DAYS_BEFORE_REVIEW,

  // Diversification
  maxSingleStockPercent: 20,   // no single stock > 20% of portfolio
  maxSectorPercent: 40,         // no single sector > 40% of portfolio

  // Trailing stop
  trailingStopActivation: 10,   // activate trailing stop when up 10%
  trailingStopFloor: 5,         // trailing stop floor at 5% gain

  // Sentinel thresholds
  sentinelPollIntervalSeconds: env.SENTINEL_POLL_INTERVAL_SECONDS,
  priceSpikeTriggerPercent: 3,  // flag moves > 3% in 15-min window
  volumeSpikeTriggerMultiple: 3, // flag volume > 3x 20-day average
  urgencyEscalationThreshold: 7, // urgency >= 7 triggers immediate deep research
  urgencyQueueThreshold: 4,     // urgency 4-6 queued for next pulse

  // Intraday pulse
  intradayPulseIntervalMinutes: env.INTRADAY_PULSE_INTERVAL_MINUTES,

  // Anti-loop
  maxOscillationCount: 3,       // max buy→sell→buy cycles on same stock in 7 days
  oscillationWindowDays: 7,

  // Cooldowns (sell-side & review)
  sellCooldownMinutes: env.SELL_COOLDOWN_MINUTES,             // prevents duplicate sells of same symbol
  positionReviewCooldownMinutes: env.POSITION_REVIEW_COOLDOWN_MINUTES, // min time between AI reviews of same position
  sentinelEscalationCooldownMinutes: env.SENTINEL_ESCALATION_COOLDOWN_MINUTES, // min time between escalations of same symbol

  // API timeouts
  alpacaApiTimeoutMs: env.ALPACA_API_TIMEOUT_MS,
  aiTimeoutMs: env.AI_TIMEOUT_MS,

  // Market hours (Eastern Time)
  extendedHoursStart: 4,  // 4:00 AM ET
  extendedHoursEnd: 20,   // 8:00 PM ET
  regularHoursStart: 9.5, // 9:30 AM ET
  regularHoursEnd: 16,    // 4:00 PM ET
} as const;

export type TradingRules = typeof TRADING_RULES;
