import { TRADING_RULES } from '../config/trading-rules';
import { getAccount } from '../services/alpaca/client';
import { getPositions } from '../services/alpaca/trading';
import {
  getTradesToday,
  getTradesForSymbol,
  getRecentDecisions,
} from '../services/db/queries';
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
  action: 'BUY' | 'SELL';
  notional: number;
  sector?: string;
}

export async function evaluateRisk(proposal: TradeProposal): Promise<RiskCheckResult> {
  const checks: Record<string, boolean> = {};
  const reasons: string[] = [];

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
    const totalInvested = positions.reduce((sum, p) => sum + parseFloat(p.market_value), 0);

    // ─── Position-level checks ─────────────────────────

    // 1. Position size within limit
    checks.positionSizeWithinLimit = proposal.notional <= TRADING_RULES.maxPositionSizeDollars;
    if (!checks.positionSizeWithinLimit) {
      reasons.push(`Position size $${proposal.notional} exceeds max $${TRADING_RULES.maxPositionSizeDollars}`);
    }

    // 2. Not in cooldown (for buys only)
    if (proposal.action === 'BUY') {
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

      // 3. Not revenge trading (buying back after selling at a loss)
      const lastSell = recentTrades.find((t) => t.action === 'SELL');
      if (lastSell) {
        const lastBuyBeforeSell = recentTrades.find(
          (t) => t.action === 'BUY' && new Date(t.createdAt) < new Date(lastSell.createdAt)
        );
        const wasLoss = lastBuyBeforeSell && lastSell.price < lastBuyBeforeSell.price;
        if (wasLoss) {
          const hoursSinceLoss = hoursSince(new Date(lastSell.createdAt));
          checks.notRevengeTrading = hoursSinceLoss >= TRADING_RULES.revengeTradeCooldownHours;
          if (!checks.notRevengeTrading) {
            reasons.push(`Revenge trade cooldown: sold ${proposal.symbol} at loss ${hoursSinceLoss}h ago, need ${TRADING_RULES.revengeTradeCooldownHours}h`);
          }
        } else {
          checks.notRevengeTrading = true;
        }
      } else {
        checks.notRevengeTrading = true;
      }
    } else {
      checks.notInCooldown = true;
      checks.notRevengeTrading = true;
    }

    // ─── Portfolio-level checks ────────────────────────

    // 4. Total exposure within limit
    const proposedExposure = proposal.action === 'BUY'
      ? totalInvested + proposal.notional
      : totalInvested;
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
    checks.dailyLossCircuitBreakerOff = dailyPLPercent > -TRADING_RULES.maxDailyLossPercent;
    if (!checks.dailyLossCircuitBreakerOff) {
      reasons.push(`Circuit breaker: portfolio down ${dailyPLPercent.toFixed(2)}% today (limit: -${TRADING_RULES.maxDailyLossPercent}%)`);
    }

    // ─── Diversification checks ────────────────────────

    // 7. Single stock concentration
    if (proposal.action === 'BUY') {
      const existingPosition = positions.find((p) => p.symbol === proposal.symbol);
      const existingValue = existingPosition ? parseFloat(existingPosition.market_value) : 0;
      const newValue = existingValue + proposal.notional;
      const concentrationPercent = portfolioValue > 0 ? (newValue / portfolioValue) * 100 : 0;
      checks.singleStockConcentration = concentrationPercent <= TRADING_RULES.maxSingleStockPercent;
      if (!checks.singleStockConcentration) {
        reasons.push(`${proposal.symbol} would be ${concentrationPercent.toFixed(1)}% of portfolio (max ${TRADING_RULES.maxSingleStockPercent}%)`);
      }
    } else {
      checks.singleStockConcentration = true;
    }

    // 8. Sector concentration (simplified — uses tags from proposal)
    checks.sectorConcentration = true; // Simplified for now, enhanced later with sector tracking

    // ─── Anti-loop checks ──────────────────────────────

    // 9. Not oscillating (buy→sell→buy pattern)
    if (proposal.action === 'BUY') {
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
    if (lastDecision && proposal.action === 'BUY') {
      const lastWasSell = lastDecision.decision === 'SELL' || lastDecision.decision === 'EXIT';
      const minutesSinceDecision = minutesSince(new Date(lastDecision.createdAt));
      checks.decisionDifferentFromLast = !(lastWasSell && minutesSinceDecision < 60);
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
    log.warn(`Trade BLOCKED: ${proposal.action} ${proposal.symbol} $${proposal.notional}`, {
      reasons,
      checks,
    });
  } else {
    log.info(`Trade APPROVED: ${proposal.action} ${proposal.symbol} $${proposal.notional}`);
  }

  return { allPassed, details: checks, blockedReason };
}
