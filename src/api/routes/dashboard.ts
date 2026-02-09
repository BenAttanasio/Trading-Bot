import { Router } from 'express';
import { getAccount } from '../../services/alpaca/client';
import { getPositions } from '../../services/alpaca/trading';
import { getAllPositions, getRecentTrades, getRecentAlerts, getDailySummaries, getDecisionsToday } from '../../services/db/queries';
import { isTradingPaused } from '../../engine/execution';
import { getMarketState } from '../../services/scheduler/market-hours';

export const dashboardRouter = Router();

// GET /api/dashboard — aggregated dashboard data (single endpoint for efficiency)
dashboardRouter.get('/', async (req, res) => {
  try {
    const [account, alpacaPositions, dbPositions, recentTrades, recentAlerts, dailySummaries, decisionsToday, marketState] = await Promise.all([
      getAccount(),
      getPositions(),
      getAllPositions(),
      getRecentTrades(20),
      getRecentAlerts(20),
      getDailySummaries(30),
      getDecisionsToday(),
      getMarketState(),
    ]);

    const portfolioValue = parseFloat(account.portfolio_value);
    const lastEquity = parseFloat(account.last_equity);
    const dailyPL = portfolioValue - lastEquity;
    const dailyPLPercent = lastEquity > 0 ? (dailyPL / lastEquity) * 100 : 0;

    const positions = alpacaPositions.map((ap) => {
      const db = dbPositions.find((d) => d.symbol === ap.symbol);
      return {
        symbol: ap.symbol,
        qty: parseFloat(ap.qty),
        entryPrice: parseFloat(ap.avg_entry_price),
        currentPrice: parseFloat(ap.current_price),
        marketValue: parseFloat(ap.market_value),
        unrealizedPL: parseFloat(ap.unrealized_pl),
        unrealizedPLPercent: parseFloat(ap.unrealized_plpc) * 100,
        thesis: db?.thesis || null,
        thesisFreshness: db?.thesisFreshness || null,
        daysHeld: db?.daysHeld || 0,
      };
    });

    res.json({
      status: {
        botRunning: true,
        tradingPaused: isTradingPaused(),
        marketState,
        lastHeartbeat: new Date().toISOString(),
      },
      portfolio: {
        value: portfolioValue,
        cash: parseFloat(account.cash),
        invested: parseFloat(account.long_market_value),
        dailyPL,
        dailyPLPercent,
        positionCount: alpacaPositions.length,
      },
      positions,
      recentTrades: recentTrades.map((t) => ({
        symbol: t.symbol,
        action: t.action,
        notional: t.notional,
        price: t.price,
        trigger: t.trigger,
        aiReasoning: t.aiReasoning,
        aiConviction: t.aiConviction,
        orderStatus: t.orderStatus,
        createdAt: t.createdAt,
      })),
      recentAlerts: recentAlerts.map((a) => ({
        type: a.type,
        symbol: a.symbol,
        urgency: a.urgency,
        direction: a.direction,
        headline: a.headline,
        actionTaken: a.actionTaken,
        createdAt: a.createdAt,
      })),
      dailySummaries: dailySummaries.slice(0, 7),
      todayStats: {
        tradesExecuted: decisionsToday.filter((d) => d.executed).length,
        tradesBlocked: decisionsToday.filter((d) => d.decision === 'BLOCKED').length,
        alertsToday: recentAlerts.filter(
          (a) => new Date(a.createdAt).toDateString() === new Date().toDateString()
        ).length,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
