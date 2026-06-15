import { Router } from 'express';
import { getRecentOutcomes } from '../../services/db/queries';
import { TradeOutcome } from '../../services/db/models/trade-outcome';

export const outcomesRouter = Router();

function computeStats(outcomes: TradeOutcome[]) {
  if (outcomes.length === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      avgPLPercent: 0,
      avgDaysHeld: 0,
      byTrigger: {},
      byConviction: {
        high: { range: '8-10', count: 0, winRate: 0 },
        mid:  { range: '6-7',  count: 0, winRate: 0 },
        low:  { range: '1-5',  count: 0, winRate: 0 },
      },
    };
  }

  const wins = outcomes.filter((o) => o.realizedPLPercent > 0);
  const winRate = wins.length / outcomes.length;
  const avgPLPercent = outcomes.reduce((s, o) => s + o.realizedPLPercent, 0) / outcomes.length;
  const avgDaysHeld = outcomes.reduce((s, o) => s + o.daysHeld, 0) / outcomes.length;

  // by trigger
  const triggerMap: Record<string, TradeOutcome[]> = {};
  for (const o of outcomes) {
    (triggerMap[o.entryTrigger] ??= []).push(o);
  }
  const byTrigger: Record<string, { count: number; winRate: number; avgPL: number }> = {};
  for (const [trigger, group] of Object.entries(triggerMap)) {
    const w = group.filter((o) => o.realizedPLPercent > 0).length;
    byTrigger[trigger] = {
      count: group.length,
      winRate: w / group.length,
      avgPL: group.reduce((s, o) => s + o.realizedPLPercent, 0) / group.length,
    };
  }

  // by conviction
  function convictionGroup(conviction: number): 'high' | 'mid' | 'low' {
    if (conviction >= 8) return 'high';
    if (conviction >= 6) return 'mid';
    return 'low';
  }
  const convictionMap: Record<'high' | 'mid' | 'low', TradeOutcome[]> = { high: [], mid: [], low: [] };
  for (const o of outcomes) convictionMap[convictionGroup(o.aiConviction)].push(o);

  function convStats(group: TradeOutcome[]) {
    if (group.length === 0) return { count: 0, winRate: 0 };
    return {
      count: group.length,
      winRate: group.filter((o) => o.realizedPLPercent > 0).length / group.length,
    };
  }

  return {
    totalTrades: outcomes.length,
    winRate,
    avgPLPercent,
    avgDaysHeld,
    byTrigger,
    byConviction: {
      high: { range: '8-10', ...convStats(convictionMap.high) },
      mid:  { range: '6-7',  ...convStats(convictionMap.mid) },
      low:  { range: '1-5',  ...convStats(convictionMap.low) },
    },
  };
}

// GET /api/outcomes
outcomesRouter.get('/', async (req, res) => {
  try {
    const outcomes = await getRecentOutcomes(50);
    const stats = computeStats(outcomes);
    res.json({ outcomes, stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
