import { Router } from 'express';
import { getAccount } from '../../services/alpaca/client';
import { getPositions } from '../../services/alpaca/trading';
import { getAllPositions, getRecentTrades, getRecentAlerts, getDailySummaries, getDecisionsToday } from '../../services/db/queries';
import { isTradingPaused } from '../../engine/execution';
import { getMarketState } from '../../services/scheduler/market-hours';
import { getETDateISO, getETHour } from '../../utils/time';
import { TRADING_RULES } from '../../config/trading-rules';

export const dashboardRouter = Router();

function computeNextPulse(marketState: string): { time: string; label: string } {
  const now = new Date();
  const etHour = getETHour(now);
  const interval = TRADING_RULES.intradayPulseIntervalMinutes;

  // During extended hours (4-19 ET on a market day): compute next interval boundary
  if (marketState !== 'closed') {
    const currentMinuteOfHour = Math.floor((etHour % 1) * 60);
    const currentHourFloor = Math.floor(etHour);
    const totalMinutesSinceMidnight = currentHourFloor * 60 + currentMinuteOfHour;
    const minutesSincePulse = totalMinutesSinceMidnight % interval;
    const minutesUntilNext = interval - minutesSincePulse;

    const nextPulseTime = new Date(now.getTime() + minutesUntilNext * 60 * 1000);
    const mins = minutesUntilNext;
    const label = mins < 1 ? 'Pulse imminent' : `Next pulse in ${mins}m`;
    return { time: nextPulseTime.toISOString(), label };
  }

  // Market closed: find next 4:00 AM ET on a weekday
  // Approximate by adding days until we hit a weekday
  const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = etDate.getDay(); // 0=Sun, 6=Sat

  let daysUntilNext = 1;
  if (dayOfWeek === 5 && etHour >= 20) daysUntilNext = 3;      // Friday night -> Monday
  else if (dayOfWeek === 6) daysUntilNext = 2;                   // Saturday -> Monday
  else if (dayOfWeek === 0) daysUntilNext = 1;                   // Sunday -> Monday
  else if (etHour < 4) daysUntilNext = 0;                        // Before 4 AM on weekday -> today

  const nextDate = new Date(now.getTime() + daysUntilNext * 24 * 60 * 60 * 1000);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const nextDayName = dayNames[new Date(nextDate.toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay()];
  const label = `Market closed — next session ${nextDayName} 4:00 AM ET`;
  return { time: '', label };
}

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

    // Inject live "today" data point so chart isn't stuck on yesterday
    const todayISO = getETDateISO();
    const historicalSummaries = dailySummaries.slice(0, 7);
    const todayExists = historicalSummaries.some((s) => s.date === todayISO);
    const summariesWithToday = todayExists
      ? historicalSummaries
      : [
          {
            date: todayISO,
            portfolioValue,
            dailyPL,
            dailyPLPercent,
            tradesExecuted: decisionsToday.filter((d) => d.executed).length,
            aiSummary: 'Live — end-of-day summary pending',
          },
          ...historicalSummaries,
        ];

    res.json({
      status: {
        botRunning: true,
        tradingPaused: isTradingPaused(),
        marketState,
        lastHeartbeat: new Date().toISOString(),
        nextPulse: computeNextPulse(marketState),
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
      dailySummaries: summariesWithToday,
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
