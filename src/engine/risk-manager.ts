import { TRADING_RULES } from '../config/trading-rules';
import { HARD_LIMITS } from '../config/hard-limits';
import { env } from '../config/env';
import { getAccount } from '../services/alpaca/client';
import { getPositions } from '../services/alpaca/trading';
import {
  getTradesToday,
  getTradesForSymbol,
  getRecentDecisions,
} from '../services/db/queries';
import { TradeIntent } from '../services/db/models/trade';
import { createServiceLogger } from '../utils/logger';
import { minutesSince, hoursSince } from '../utils/time';

const log = createServiceLogger('RiskManager');

export interface RiskCheckResult {
  allPassed: boolean;
  details: Record<string, boolean>;
  blockedReason: string | null;
}

export interface TradeProposal {
  symbol: string;
  /** Alpaca side. */
  action: 'BUY' | 'SELL';
  notional: number;
  sector?: string;
  /** Defaults: BUY = open_long, SELL = close_long. */
  intent?: TradeIntent;
}

export function intentFor(proposal: Pick<TradeProposal, 'action' | 'intent'>): TradeIntent {
  return proposal.intent ?? (proposal.action === 'BUY' ? 'open_long' : 'close_long');
}

export function isOpeningIntent(intent: TradeIntent): boolean {
  return intent === 'open_long' || intent === 'open_short';
}

export async function evaluateRisk(proposal: TradeProposal): Promise<RiskCheckResult> {
  const checks: Record<string, boolean> = {};
  const reasons: string[] = [];
  const intent = intentFor(proposal);
  const opening = isOpeningIntent(intent);

  try {
    // Fetch current state in parallel
    const [account, positions, tradesToday, recentTrades, recentDecisions] = await Promise.all([
      getAccount(),
      getPositions(),
      getTradesToday(),
      getTradesForSymbol(proposal.symbol, 7),
      getRecentDecisions(proposal.symbol, 5),
    ]);

    const portfolioValue = parseFloat(account.portfolio_value);
    const lastEquity = parseFloat(account.last_equity);
    // Gross exposure: shorts count with their absolute value
    const totalInvested = positions.reduce((sum, p) => sum + Math.abs(parseFloat(p.market_value)), 0);

    // ─── Intent-level checks ───────────────────────────

    // 0. Shorts must be enabled in env AND on the account
    if (intent === 'open_short') {
      checks.shortsAllowed = env.ENABLE_SHORTS && account.shorting_enabled !== false;
      if (!checks.shortsAllowed) {
        reasons.push(env.ENABLE_SHORTS ? 'Account does not allow shorting' : 'Shorts disabled (ENABLE_SHORTS=0)');
      }
    } else {
      checks.shortsAllowed = true;
    }

    // ─── Position-level checks (opening intents only — never block an exit on size) ─

    // 1. Position size within limit
    checks.positionSizeWithinLimit = !opening || proposal.notional <= TRADING_RULES.maxPositionSizeDollars;
    if (!checks.positionSizeWithinLimit) {
      reasons.push(`Position size $${proposal.notional} exceeds max $${TRADING_RULES.maxPositionSizeDollars}`);
    }

    // 1b. Hard limit: no single entry may exceed a fixed % of account equity, whatever the rules say
    const hardMaxPosition = portfolioValue * (HARD_LIMITS.maxPositionPercentOfEquity / 100);
    checks.withinHardPositionLimit = !opening || portfolioValue <= 0 || proposal.notional <= hardMaxPosition;
    if (!checks.withinHardPositionLimit) {
      reasons.push(`HARD LIMIT: $${proposal.notional} exceeds ${HARD_LIMITS.maxPositionPercentOfEquity}% of equity ($${hardMaxPosition.toFixed(2)})`);
    }

    // 2 & 3. Cooldown and revenge-trading checks
    if (opening) {
      // 2. Not in cooldown
      const lastTradeForSymbol = recentTrades[0];
      if (lastTradeForSymbol) {
        const minutesSinceLastTrade = minutesSince(new Date(lastTradeForSymbol.createdAt));
        checks.notInCooldown = minutesSinceLastTrade >= TRADING_RULES.cooldownMinutes;
        if (!checks.notInCooldown) {
          reasons.push(`Cooldown active: ${TRADING_RULES.cooldownMinutes - minutesSinceLastTrade}m remaining for ${proposal.symbol}`);
        }
      } else {
        checks.notInCooldown = true;
      }

      // 3. Not revenge trading (re-entering after closing at a loss)
      const lastClose = recentTrades.find((t) => (t.intent ? !isOpeningIntent(t.intent) : t.action === 'SELL'));
      if (lastClose) {
        const lastOpenBefore = recentTrades.find(
          (t) => (t.intent ? isOpeningIntent(t.intent) : t.action === 'BUY') && new Date(t.createdAt) < new Date(lastClose.createdAt)
        );
        const closeSide = lastClose.intent === 'close_short' ? 'short' : 'long';
        const wasLoss = lastOpenBefore && (closeSide === 'long' ? lastClose.price < lastOpenBefore.price : lastClose.price > lastOpenBefore.price);
        if (wasLoss) {
          const hoursSinceLoss = hoursSince(new Date(lastClose.createdAt));
          checks.notRevengeTrading = hoursSinceLoss >= TRADING_RULES.revengeTradeCooldownHours;
          if (!checks.notRevengeTrading) {
            reasons.push(`Revenge trade cooldown: closed ${proposal.symbol} at loss ${hoursSinceLoss}h ago, need ${TRADING_RULES.revengeTradeCooldownHours}h`);
          }
        } else {
          checks.notRevengeTrading = true;
        }
      } else {
        checks.notRevengeTrading = true;
      }
    } else {
      // Closing: block if we already closed this symbol recently (prevents duplicate exits on job overlap)
      const lastCloseForSymbol = recentTrades.find((t) => (t.intent ? !isOpeningIntent(t.intent) : t.action === 'SELL'));
      if (lastCloseForSymbol) {
        const minutesSinceLastClose = minutesSince(new Date(lastCloseForSymbol.createdAt));
        checks.notInCooldown = minutesSinceLastClose >= TRADING_RULES.sellCooldownMinutes;
        if (!checks.notInCooldown) {
          reasons.push(`Sell cooldown active: already closed ${proposal.symbol} ${minutesSinceLastClose}m ago (cooldown: ${TRADING_RULES.sellCooldownMinutes}m)`);
        }
      } else {
        checks.notInCooldown = true;
      }
      checks.notRevengeTrading = true; // revenge-trading check only applies to entries
    }

    // ─── Portfolio-level checks ────────────────────────

    // 4. Total (gross) exposure within limit
    const proposedExposure = opening ? totalInvested + proposal.notional : totalInvested;
    checks.totalExposureWithinLimit = proposedExposure <= TRADING_RULES.maxPortfolioExposure;
    if (!checks.totalExposureWithinLimit) {
      reasons.push(`Portfolio exposure $${proposedExposure.toFixed(2)} would exceed max $${TRADING_RULES.maxPortfolioExposure}`);
    }

    // 5. Daily trade count within limit
    checks.dailyTradeCountWithinLimit = tradesToday.length < TRADING_RULES.maxDailyTrades;
    if (!checks.dailyTradeCountWithinLimit) {
      reasons.push(`Daily trade limit reached: ${tradesToday.length}/${TRADING_RULES.maxDailyTrades}`);
    }

    // 6. Daily loss circuit breaker
    const dailyPLPercent = lastEquity > 0
      ? ((portfolioValue - lastEquity) / lastEquity) * 100
      : 0;
    // The configured limit can be tightened by env/playbook but never loosened past the hard ceiling
    const effectiveMaxDailyLoss = Math.min(TRADING_RULES.maxDailyLossPercent, HARD_LIMITS.maxDailyLossPercent);
    checks.dailyLossCircuitBreakerOff = dailyPLPercent > -effectiveMaxDailyLoss;
    if (!checks.dailyLossCircuitBreakerOff) {
      reasons.push(`Circuit breaker: portfolio down ${dailyPLPercent.toFixed(2)}% today (limit: -${effectiveMaxDailyLoss}%)`);
    }

    // ─── Diversification checks ────────────────────────

    // 7. Single stock concentration
    if (opening) {
      const existingPosition = positions.find((p) => p.symbol === proposal.symbol);
      const existingValue = existingPosition ? Math.abs(parseFloat(existingPosition.market_value)) : 0;
      const newValue = existingValue + proposal.notional;
      const concentrationPercent = portfolioValue > 0 ? (newValue / portfolioValue) * 100 : 0;
      checks.singleStockConcentration = concentrationPercent <= TRADING_RULES.maxSingleStockPercent;
      if (!checks.singleStockConcentration) {
        reasons.push(`${proposal.symbol} would be ${concentrationPercent.toFixed(1)}% of portfolio (max ${TRADING_RULES.maxSingleStockPercent}%)`);
      }
      // 7b. Never open a short against a long or vice versa
      const existingSide = existingPosition ? (existingPosition.side === 'short' ? 'short' : 'long') : null;
      const wantSide = intent === 'open_short' ? 'short' : 'long';
      checks.noOpposingPosition = existingSide === null || existingSide === wantSide;
      if (!checks.noOpposingPosition) {
        reasons.push(`Already ${existingSide} ${proposal.symbol}; close it before opening a ${wantSide}`);
      }
    } else {
      checks.singleStockConcentration = true;
      checks.noOpposingPosition = true;
    }

    // 8. Sector concentration (simplified — uses tags from proposal)
    checks.sectorConcentration = true; // Simplified for now, enhanced later with sector tracking

    // ─── Anti-loop checks ──────────────────────────────

    // 9. Not oscillating (open→close→open pattern)
    if (opening) {
      const oscillations = recentTrades.reduce((count, trade, i) => {
        if (i > 0 && trade.action !== recentTrades[i - 1].action) return count + 1;
        return count;
      }, 0);
      checks.notOscillating = oscillations < TRADING_RULES.maxOscillationCount;
      if (!checks.notOscillating) {
        reasons.push(`Oscillation detected: ${oscillations} direction changes on ${proposal.symbol} in ${TRADING_RULES.oscillationWindowDays} days`);
      }
    } else {
      checks.notOscillating = true;
    }

    // 10. Decision different from last (AI not flip-flopping)
    const lastDecision = recentDecisions[0];
    if (lastDecision && opening) {
      const lastWasClose = lastDecision.decision === 'SELL' || lastDecision.decision === 'EXIT';
      const minutesSinceDecision = minutesSince(new Date(lastDecision.createdAt));
      checks.decisionDifferentFromLast = !(lastWasClose && minutesSinceDecision < 60);
      if (!checks.decisionDifferentFromLast) {
        reasons.push(`AI flip-flop: decided to ${lastDecision.decision} ${proposal.symbol} ${minutesSinceDecision}m ago`);
      }
    } else {
      checks.decisionDifferentFromLast = true;
    }
  } catch (error) {
    log.error('Risk evaluation error — blocking trade as precaution', { error, proposal });
    return {
      allPassed: false,
      details: { evaluationError: false },
      blockedReason: `Risk evaluation error: ${error}`,
    };
  }

  const allPassed = Object.values(checks).every(Boolean);
  const blockedReason = reasons.length > 0 ? reasons.join('; ') : null;

  if (!allPassed) {
    log.warn(`Trade BLOCKED: ${intent} ${proposal.symbol} $${proposal.notional}`, {
      reasons,
      checks,
    });
  } else {
    log.info(`Trade APPROVED: ${intent} ${proposal.symbol} $${proposal.notional}`);
  }

  return { allPassed, details: checks, blockedReason };
}
