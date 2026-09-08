import { describe, it, expect } from 'vitest';
import { computeTradeStats, computeEquityStats, computeAICostStats } from '../src/engine/stats';
import type { TradeOutcome } from '../src/services/db/models/trade-outcome';

function outcome(pl: number, dollars: number, extra: Partial<TradeOutcome> = {}): TradeOutcome {
  return {
    symbol: 'X',
    entryTrigger: 'morning_research',
    entryPrice: 100,
    exitPrice: 100 + pl,
    entryDate: new Date('2026-09-01'),
    exitDate: new Date('2026-09-05'),
    daysHeld: 4,
    realizedPLPercent: pl,
    realizedPLDollars: dollars,
    aiConviction: 7,
    originalThesis: '',
    exitReason: 'ai_exit',
    exitWorkflow: 'portfolio_manager',
    thesisFreshness: 'fresh',
    createdAt: new Date(),
    ...extra,
  };
}

describe('computeTradeStats', () => {
  it('handles an empty set', () => {
    const s = computeTradeStats([]);
    expect(s.n).toBe(0);
    expect(s.expectancyPct).toBeNull();
    expect(s.profitFactor).toBeNull();
  });

  it('computes expectancy, profit factor and groupings', () => {
    const s = computeTradeStats([
      outcome(10, 100),
      outcome(-5, -50, { exitReason: 'hard_stop', side: 'short' }),
      outcome(4, 40, { entryTrigger: 'sentinel' }),
    ]);
    expect(s.n).toBe(3);
    expect(s.winRate).toBeCloseTo(2 / 3);
    expect(s.expectancyPct).toBeCloseTo(3);
    expect(s.profitFactor).toBeCloseTo(140 / 50);
    expect(s.avgWinPct).toBeCloseTo(7);
    expect(s.avgLossPct).toBeCloseTo(-5);
    expect(s.byExitReason.hard_stop.n).toBe(1);
    expect(s.byTrigger.sentinel.avgPLPct).toBeCloseTo(4);
    expect(s.bySide.short.n).toBe(1);
    expect(s.bySide.long.n).toBe(2);
  });

  it('reports an infinite profit factor with no losers', () => {
    expect(computeTradeStats([outcome(3, 30)]).profitFactor).toBe(Infinity);
  });
});

describe('computeEquityStats', () => {
  it('needs at least two points', () => {
    expect(computeEquityStats([{ date: '2026-09-01', equity: 100 }]).sharpe).toBeNull();
  });

  it('computes drawdown and total return, and Sharpe once there are 5+ sessions', () => {
    const pts = [100, 102, 101, 104, 103, 106].map((e, i) => ({ date: `2026-09-0${i + 1}`, equity: e }));
    const s = computeEquityStats(pts);
    expect(s.days).toBe(6);
    expect(s.totalReturnPct).toBeCloseTo(6);
    expect(s.maxDrawdownPct).toBeCloseTo((102 - 101) / 102 * 100); // the 102→101 dip is the deepest
    expect(s.sharpe).not.toBeNull();
    expect(s.sharpe!).toBeGreaterThan(0);
  });

  it('sorts by date so out-of-order input does not corrupt returns', () => {
    const s = computeEquityStats([
      { date: '2026-09-03', equity: 110 },
      { date: '2026-09-01', equity: 100 },
      { date: '2026-09-02', equity: 105 },
    ]);
    expect(s.totalReturnPct).toBeCloseTo(10);
    expect(s.maxDrawdownPct).toBe(0);
  });
});

describe('computeAICostStats', () => {
  it('annualizes the trailing average against equity', () => {
    const s = computeAICostStats({
      todayUsd: 1,
      dailyCosts: [{ date: '2026-09-05', aiCostUsd: 2 }, { date: '2026-09-04', aiCostUsd: 4 }, { date: '2026-09-03' }],
      equity: 10_000,
    });
    expect(s.daysWithData).toBe(2);
    expect(s.avgPerTradingDayUsd).toBe(3);
    expect(s.annualizedUsd).toBe(756);
    expect(s.annualizedPctOfEquity).toBeCloseTo(7.56);
  });

  it('falls back to today when there is no history', () => {
    const s = computeAICostStats({ todayUsd: 0.5, dailyCosts: [], equity: 1000 });
    expect(s.avgPerTradingDayUsd).toBe(0.5);
    expect(s.annualizedPctOfEquity).toBeCloseTo(12.6);
  });
});
