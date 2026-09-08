import { env } from './env';
import { clampTunable, isTunableKey, TunableKey } from './hard-limits';

export interface TradingRules {
  // Position limits
  maxPositionSizeDollars: number;
  maxPortfolioExposure: number;
  // Daily limits
  maxDailyTrades: number;
  maxDailyLossPercent: number;
  // Cooldowns
  cooldownMinutes: number;
  revengeTradeCooldownHours: number;
  // Position management
  maxHoldDaysBeforeReview: number;
  // Diversification
  maxSingleStockPercent: number;
  maxSectorPercent: number;
  // Trailing stop
  trailingStopActivation: number;
  trailingStopFloor: number;
  // Sentinel thresholds
  sentinelPollIntervalSeconds: number;
  priceSpikeTriggerPercent: number;
  volumeSpikeTriggerMultiple: number;
  urgencyEscalationThreshold: number;
  urgencyQueueThreshold: number;
  // Intraday pulse
  intradayPulseIntervalMinutes: number;
  // Anti-loop
  maxOscillationCount: number;
  oscillationWindowDays: number;
  // Cooldowns (sell-side & review)
  sellCooldownMinutes: number;
  positionReviewCooldownMinutes: number;
  sentinelEscalationCooldownMinutes: number;
  // API timeouts
  alpacaApiTimeoutMs: number;
  aiTimeoutMs: number;
  // Market hours (Eastern Time)
  extendedHoursStart: number;
  extendedHoursEnd: number;
  regularHoursStart: number;
  regularHoursEnd: number;
}

const DEFAULTS: TradingRules = {
  maxPositionSizeDollars: env.MAX_POSITION_SIZE_DOLLARS,
  maxPortfolioExposure: env.MAX_PORTFOLIO_EXPOSURE,
  maxDailyTrades: env.MAX_DAILY_TRADES,
  maxDailyLossPercent: env.MAX_DAILY_LOSS_PERCENT,
  cooldownMinutes: env.COOLDOWN_MINUTES,
  revengeTradeCooldownHours: env.REVENGE_TRADE_COOLDOWN_HOURS,
  maxHoldDaysBeforeReview: env.MAX_HOLD_DAYS_BEFORE_REVIEW,
  maxSingleStockPercent: 20,   // no single stock > 20% of portfolio
  maxSectorPercent: 40,         // no single sector > 40% of portfolio
  trailingStopActivation: 10,   // activate trailing stop when up 10%
  trailingStopFloor: 5,         // trailing stop floor at 5% gain
  sentinelPollIntervalSeconds: env.SENTINEL_POLL_INTERVAL_SECONDS,
  priceSpikeTriggerPercent: 3,  // flag moves > 3% in 15-min window
  volumeSpikeTriggerMultiple: 3, // flag volume > 3x 20-day average
  urgencyEscalationThreshold: 7, // urgency >= 7 triggers immediate deep research
  urgencyQueueThreshold: 4,     // urgency 4-6 queued for next pulse
  intradayPulseIntervalMinutes: env.INTRADAY_PULSE_INTERVAL_MINUTES,
  maxOscillationCount: 3,       // max buy→sell→buy cycles on same stock in 7 days
  oscillationWindowDays: 7,
  sellCooldownMinutes: env.SELL_COOLDOWN_MINUTES,
  positionReviewCooldownMinutes: env.POSITION_REVIEW_COOLDOWN_MINUTES,
  sentinelEscalationCooldownMinutes: env.SENTINEL_ESCALATION_COOLDOWN_MINUTES,
  alpacaApiTimeoutMs: env.ALPACA_API_TIMEOUT_MS,
  aiTimeoutMs: env.AI_TIMEOUT_MS,
  extendedHoursStart: 4,  // 4:00 AM ET
  extendedHoursEnd: 20,   // 8:00 PM ET
  regularHoursStart: 9.5, // 9:30 AM ET
  regularHoursEnd: 16,    // 4:00 PM ET
};

/**
 * Live rules object. Env provides the defaults; the playbook may tune the keys
 * listed in TUNABLE_BOUNDS at runtime (always clamped). Read properties at call
 * time — do not copy them into module-level constants.
 */
export const TRADING_RULES: TradingRules = { ...DEFAULTS };

export function getDefaultRules(): Readonly<TradingRules> {
  return DEFAULTS;
}

/** Apply tuned params (unknown keys ignored, values clamped). Returns what was applied. */
export function applyTunedParams(params: Record<string, unknown>): Partial<Record<TunableKey, number>> {
  const applied: Partial<Record<TunableKey, number>> = {};
  for (const [key, raw] of Object.entries(params ?? {})) {
    if (!isTunableKey(key)) continue;
    const value = clampTunable(key, Number(raw));
    (TRADING_RULES as unknown as Record<string, number>)[key] = value;
    applied[key] = value;
  }
  return applied;
}

/** Revert every rule to its env default (used when the playbook is reset). */
export function resetTunedParams(): void {
  Object.assign(TRADING_RULES, DEFAULTS);
}
