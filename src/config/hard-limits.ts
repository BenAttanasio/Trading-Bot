/**
 * HARD LIMITS — absolute ceilings that nothing else may override.
 *
 * TRADING_RULES (env-driven) and the playbook (self-tuned at runtime) may be
 * *tighter* than these, never looser. The self-improvement agent is not allowed
 * to edit this file; it is enforced in code, not in prompts.
 */
export const HARD_LIMITS = {
  /** Daily loss circuit breaker ceiling, % of last equity. */
  maxDailyLossPercent: 5,
  /** Max single position as % of account equity. */
  maxPositionPercentOfEquity: 25,
  /** Max total invested as % of account equity (100 = no leverage). */
  maxPortfolioExposurePercentOfEquity: 100,
  /** Max total options premium at risk as % of equity (options phase). */
  maxOptionsPremiumPercentOfEquity: 10,
  /** Max trades per day across all workflows. */
  maxDailyTrades: 40,
  /** Minimum re-buy cooldown in minutes. */
  minCooldownMinutes: 5,
  /** Exact value LIVE_TRADING must hold for a non-paper endpoint to start. */
  liveTradingConfirmation: 'I_UNDERSTAND',
} as const;

export interface TunableBounds {
  min: number;
  max: number;
}

/** Bounds for values the playbook may tune at runtime. Keys mirror TRADING_RULES. */
export const TUNABLE_BOUNDS = {
  maxPositionSizeDollars: { min: 1, max: 100_000 },
  maxPortfolioExposure: { min: 1, max: 10_000_000 },
  maxDailyTrades: { min: 1, max: HARD_LIMITS.maxDailyTrades },
  maxDailyLossPercent: { min: 0.5, max: HARD_LIMITS.maxDailyLossPercent },
  cooldownMinutes: { min: HARD_LIMITS.minCooldownMinutes, max: 24 * 60 },
  sellCooldownMinutes: { min: 1, max: 24 * 60 },
  revengeTradeCooldownHours: { min: 1, max: 24 * 14 },
  maxSingleStockPercent: { min: 1, max: HARD_LIMITS.maxPositionPercentOfEquity },
  trailingStopActivation: { min: 1, max: 100 },
  trailingStopFloor: { min: 0, max: 99 },
  intradayPulseIntervalMinutes: { min: 5, max: 240 },
  positionReviewCooldownMinutes: { min: 5, max: 24 * 60 },
  /** % of equity risked per trade between entry and stop (volatility-scaled sizing). */
  riskPerTradePercent: { min: 0.1, max: 2 },
  /** Stop distance in ATR(14) multiples when the decision gives no usable stop. */
  atrStopMultiple: { min: 1, max: 4 },
} as const satisfies Record<string, TunableBounds>;

export type TunableKey = keyof typeof TUNABLE_BOUNDS;

export function isTunableKey(key: string): key is TunableKey {
  return Object.prototype.hasOwnProperty.call(TUNABLE_BOUNDS, key);
}

/** Clamp a proposed value into its allowed bounds. Non-finite input returns the lower bound. */
export function clampTunable(key: TunableKey, value: number): number {
  const { min, max } = TUNABLE_BOUNDS[key];
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
