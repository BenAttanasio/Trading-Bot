import { TRADING_RULES } from '../../../config/trading-rules';
import { env } from '../../../config/env';

/**
 * Stable rules block shared by every trading prompt. It lives inside the cached
 * system prompt, so keep it free of anything that changes between calls.
 */
export function buildRulesBlock(): string {
  return `PORTFOLIO RULES (enforced in code — anything outside them is blocked, so do not propose it):
- Max position size: $${TRADING_RULES.maxPositionSizeDollars}
- Max total exposure: $${TRADING_RULES.maxPortfolioExposure}
- Max trades per day: ${TRADING_RULES.maxDailyTrades}
- Daily loss circuit breaker: -${TRADING_RULES.maxDailyLossPercent}%
- Single-stock cap: ${TRADING_RULES.maxSingleStockPercent}% of portfolio
- Re-buy cooldown: ${TRADING_RULES.cooldownMinutes}m after any trade in a symbol; sell cooldown: ${TRADING_RULES.sellCooldownMinutes}m
- Sizing is done in code: risk ${TRADING_RULES.riskPerTradePercent}% of equity between entry and stop, scaled by measured calibration. Your job is the stop, the target and the horizon, not the dollar amount.
- Exits are enforced in code: the stop price, the target price and the time stop (horizon) you state are executed without asking you again. A review may tighten a stop, never loosen it.
- Trailing stop: activates at +${TRADING_RULES.trailingStopActivation}%, floor +${TRADING_RULES.trailingStopFloor}%
- Universe: liquid US equities. Shorts ${env.ENABLE_SHORTS ? 'ARE allowed (whole shares, easy-to-borrow names only)' : 'are NOT allowed — bearish views can only be expressed as PASS or EXIT'}.
- Style: cross-sectional momentum + catalyst hybrid, 1-30 day horizon. Rank names against each other and against the market; a stock that merely tracks SPY has no edge.`;
}

/** Volatile context block for the morning cycle when the book is (almost) all cash. */
export function buildInitialDeploymentNote(investedPct: number, maxBuys: number, maxPosition: number): string {
  return `INITIAL DEPLOYMENT MODE: the portfolio is ${investedPct.toFixed(1)}% invested and we are establishing a starting book today. The usual "no fresh catalyst = PASS" rule is relaxed for this session: rank names on relative strength vs SPY and sector, trend (above the 20-day SMA, RSI 45-70), sector momentum, and any upcoming dated catalyst, and recommend the strongest setups as core positions sized up to $${maxPosition} each (up to ${maxBuys} names today). Still PASS anything with a clear negative: broken trend, RSI > 75, an imminent binary event we cannot handicap, or news that contradicts the setup. State predictions honestly; a core position can carry a 0.55-0.65 confidence.`;
}

export const DATA_GAPS_NOTE = `Some data fields may be "N/A" when historical bars are unavailable (after-hours, sentinel escalations, new listings). Decide on whatever IS available — a strong catalyst plus a current price can be enough. Do not default to PASS/HOLD only because an indicator is missing; say so in the reasoning instead.`;
