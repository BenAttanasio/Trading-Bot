import { Router } from 'express';
import { env } from '../../config/env';
import { getAccount } from '../../services/alpaca/client';
import { getPositions } from '../../services/alpaca/trading';
import { getRecentTrades, getDailySummaries, getDecisionsToday, getAllPositions } from '../../services/db/queries';
import { getStartingEquity } from '../../services/db/bot-state';
import { isTradingPaused } from '../../engine/execution';
import { getMarketState } from '../../services/scheduler/market-hours';
import { getDetailedTokenUsage } from '../../services/ai/client';
import { getRecentReflections } from '../../services/db/learning-queries';
import { getBenchmarkComparison, BENCHMARK_SYMBOL } from '../../engine/benchmark';
import { computeNextPulse } from './dashboard';

export const summaryRouter = Router();

/**
 * GET /api/summary — compact snapshot for external consumers (the Unified Dashboard's
 * Trading view). Stable shape, no secrets, cheap to poll every minute.
 */
summaryRouter.get('/', async (req, res) => {
  try {
    const [account, alpacaPositions, dbPositions, recentTrades, dailySummaries, decisionsToday, marketState, startingEquity, reflections, benchmark] =
      await Promise.all([
        getAccount(),
        getPositions(),
        getAllPositions(),
        getRecentTrades(5),
        getDailySummaries(30),
        getDecisionsToday(),
        getMarketState(),
        getStartingEquity(),
        getRecentReflections(1).catch(() => []),
        getBenchmarkComparison(30).catch(() => null),
      ]);
    const lastReflection = reflections[0];

    const equity = parseFloat(account.portfolio_value);
    const lastEquity = parseFloat(account.last_equity);
    const dailyPL = equity - lastEquity;
    const dailyPLPercent = lastEquity > 0 ? (dailyPL / lastEquity) * 100 : 0;
    const totalPL = startingEquity ? equity - startingEquity : null;
    const totalPLPercent = startingEquity ? ((equity - startingEquity) / startingEquity) * 100 : null;
    const tokenUsage = getDetailedTokenUsage();

    res.json({
      updatedAt: new Date().toISOString(),
      mode: env.isPaper ? 'paper' : 'live',
      paused: isTradingPaused(),
      marketState,
      nextPulse: computeNextPulse(marketState),
      equity,
      cash: parseFloat(account.cash),
      invested: parseFloat(account.long_market_value),
      dailyPL,
      dailyPLPercent,
      totalPL,
      totalPLPercent,
      startingEquity,
      positionCount: alpacaPositions.length,
      positions: alpacaPositions.map((p) => {
        const db = dbPositions.find((d) => d.symbol === p.symbol);
        return {
          symbol: p.symbol,
          marketValue: parseFloat(p.market_value),
          plPercent: parseFloat(p.unrealized_plpc) * 100,
          daysHeld: db?.daysHeld ?? 0,
          thesis: db?.thesis ?? null,
        };
      }),
      todayStats: {
        tradesExecuted: decisionsToday.filter((d) => d.executed).length,
        tradesBlocked: decisionsToday.filter((d) => d.decision === 'BLOCKED').length,
      },
      recentActions: recentTrades.map((t) => ({
        symbol: t.symbol,
        action: t.action,
        notional: t.notional,
        trigger: t.trigger,
        conviction: t.aiConviction,
        reasoning: t.aiReasoning,
        createdAt: t.createdAt,
      })),
      equityCurve: [...dailySummaries]
        .reverse()
        .map((s) => ({ date: s.date, value: s.portfolioValue })),
      tokenBudgetPct: tokenUsage.budget > 0 ? Math.min(100, (tokenUsage.total / tokenUsage.budget) * 100) : 0,
      lastReflection: lastReflection
        ? { headline: lastReflection.headline, type: lastReflection.type, createdAt: lastReflection.createdAt }
        : null,
      benchmark:
        benchmark && benchmark.botReturnPct != null
          ? { symbol: BENCHMARK_SYMBOL, from: benchmark.from, periodReturnPct: benchmark.spyReturnPct, botReturnPct: benchmark.botReturnPct }
          : null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
