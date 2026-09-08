import { TRADING_RULES } from '../../../config/trading-rules';

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
- Trailing stop: activates at +${TRADING_RULES.trailingStopActivation}%, floor +${TRADING_RULES.trailingStopFloor}%
- Universe: US equities. Style: momentum + catalyst hybrid, 1-30 day horizon.`;
}

export const DATA_GAPS_NOTE = `Some data fields may be "N/A" when historical bars are unavailable (after-hours, sentinel escalations, new listings). Decide on whatever IS available — a strong catalyst plus a current price can be enough. Do not default to PASS/HOLD only because an indicator is missing; say so in the reasoning instead.`;
