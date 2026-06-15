import { Router } from 'express';
import { getAccount } from '../../services/alpaca/client';
import { getPositions } from '../../services/alpaca/trading';
import { getAllPositions, getRecentTrades, getRecentAlerts, getDailySummaries, getDecisionsToday } from '../../services/db/queries';
import { isTradingPaused } from '../../engine/execution';
import { getMarketState } from '../../services/scheduler/market-hours';
import { getETDateISO, getETHour } from '../../utils/time';
import { TRADING_RULES } from '../../config/trading-rules';
import { getDetailedTokenUsage } from '../../services/ai/client';
import { DecisionLog } from '../../services/db/models/decision-log';

export const dashboardRouter = Router();

type BotMoodColorKey = 'gray' | 'red' | 'orange' | 'blue' | 'green';
interface BotMood { label: string; description: string; colorKey: BotMoodColorKey }

function computeBotMood(decisions: DecisionLog[], positionCount: number): BotMood {
  if (positionCount === 0) {
    return { label: 'FLAT', description: 'Fully in cash — waiting for opportunities', colorKey: 'gray' };
  }

  const executed = decisions.filter((d) => d.executed);
  const exits = executed.filter((d) => d.decision === 'EXIT' || d.decision === 'TRIM').length;
  const buys = executed.filter((d) => d.decision === 'BUY' || d.decision === 'ADD').length;

  // Check if trailing stops fired (EXIT with specific reasoning pattern)
  const trailingStopFired = decisions.some(
    (d) => d.executed && d.decision === 'EXIT' && typeof d.aiResponse?.reasoning === 'string' && d.aiResponse.reasoning.toLowerCase().includes('trailing stop')
  );

  if (trailingStopFired) {
    return { label: 'RISK OFF', description: 'Closing positions to protect capital', colorKey: 'red' };
  }
  if (exits > buys && exits > 0) {
    return { label: 'DEFENSIVE', description: 'Reducing exposure, caution mode', colorKey: 'orange' };
  }
  if (buys > exits && buys > 0) {
    return { label: 'BULLISH', description: 'Actively building positions', colorKey: 'green' };
  }
  return { label: 'NEUTRAL', description: 'Holding current positions', colorKey: 'blue' };
}

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
    const demoMode = process.env.DEMO_MODE === '1';

    const [account, alpacaPositions, dbPositions, recentTrades, recentAlerts, dailySummaries, decisionsToday, marketState] = await Promise.all([
      getAccount(),
      demoMode ? Promise.resolve([]) : getPositions(),
      getAllPositions(),
      getRecentTrades(20),
      getRecentAlerts(20),
      getDailySummaries(90),
      getDecisionsToday(),
      getMarketState(),
    ]);

    // In demo mode, derive portfolio values from DB daily summary + DB positions
    const todayISO = getETDateISO();
    const todaySummary = dailySummaries.find((s) => s.date === todayISO);

    let portfolioValue: number;
    let cashBalance: number;
    let investedValue: number;
    let dailyPL: number;
    let dailyPLPercent: number;

    if (demoMode && todaySummary) {
      portfolioValue = todaySummary.portfolioValue;
      cashBalance = (todaySummary as any).cashBalance ?? portfolioValue * 0.82;
      investedValue = (todaySummary as any).investedValue ?? portfolioValue * 0.18;
      dailyPL = todaySummary.dailyPL;
      dailyPLPercent = todaySummary.dailyPLPercent;
    } else {
      portfolioValue = parseFloat(account.portfolio_value);
      const lastEquity = parseFloat(account.last_equity);
      cashBalance = parseFloat(account.cash);
      investedValue = parseFloat(account.long_market_value);
      dailyPL = portfolioValue - lastEquity;
      dailyPLPercent = lastEquity > 0 ? (dailyPL / lastEquity) * 100 : 0;
    }

    let positions;
    if (demoMode) {
      positions = dbPositions.map((db) => ({
        symbol: db.symbol,
        qty: db.quantity,
        entryPrice: db.entryPrice,
        currentPrice: db.currentPrice,
        marketValue: db.currentPrice * db.quantity,
        unrealizedPL: db.unrealizedPL,
        unrealizedPLPercent: db.unrealizedPLPercent,
        thesis: db.thesis || null,
        thesisFreshness: db.thesisFreshness || null,
        daysHeld: db.daysHeld || 0,
      }));
    } else {
      positions = alpacaPositions.map((ap) => {
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
    }

    // Inject live "today" data point so chart isn't stuck on yesterday
    const todayExists = dailySummaries.some((s) => s.date === todayISO);
    const summariesWithToday = todayExists
      ? dailySummaries
      : [
          {
            date: todayISO,
            portfolioValue,
            investedValue,
            dailyPL,
            dailyPLPercent,
            tradesExecuted: decisionsToday.filter((d) => d.executed).length,
            aiSummary: 'Live — end-of-day summary pending',
          },
          ...dailySummaries,
        ];

    res.json({
      status: {
        botRunning: true,
        tradingPaused: isTradingPaused(),
        marketState: demoMode ? 'open' : marketState,
        lastHeartbeat: new Date().toISOString(),
        nextPulse: demoMode ? { time: new Date(Date.now() + 18 * 60 * 1000).toISOString(), label: 'Next pulse in 18m' } : computeNextPulse(marketState),
        botMood: computeBotMood(decisionsToday, positions.length),
        tokenUsage: getDetailedTokenUsage(),
      },
      portfolio: {
        value: portfolioValue,
        cash: cashBalance,
        invested: investedValue,
        dailyPL,
        dailyPLPercent,
        positionCount: positions.length,
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
      dailySummaries: summariesWithToday.map((s) => ({
        date: s.date,
        portfolioValue: s.portfolioValue,
        investedValue: (s as any).investedValue ?? 0,
        dailyPL: s.dailyPL,
        dailyPLPercent: s.dailyPLPercent,
        tradesExecuted: s.tradesExecuted,
        aiSummary: s.aiSummary,
      })),
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
