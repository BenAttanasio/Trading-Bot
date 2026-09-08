import { describe, it, expect } from 'vitest';
import { dueDateFor, scoreDirection, excursions, computeCalibration } from '../src/engine/predictions';
import { compareToBenchmark } from '../src/engine/benchmark';
import type { Prediction } from '../src/services/db/models/prediction';
import type { Bar } from '../src/services/alpaca/market-data';

describe('dueDateFor', () => {
  it('converts trading days to calendar days (5 trading days ≈ 7 calendar days)', () => {
    const start = new Date('2026-09-07T14:00:00Z');
    const due = dueDateFor(start, 5);
    expect((due.getTime() - start.getTime()) / 86400000).toBe(7);
  });

  it('never schedules a horizon shorter than one day', () => {
    const start = new Date('2026-09-07T14:00:00Z');
    expect(dueDateFor(start, 0).getTime()).toBeGreaterThan(start.getTime());
  });
});

describe('scoreDirection', () => {
  it('scores an up call that went up as a hit with a low Brier', () => {
    const s = scoreDirection('up', 0.8, 100, 106);
    expect(s.directionHit).toBe(true);
    expect(s.realizedMovePct).toBeCloseTo(6);
    expect(s.brier).toBeCloseTo(0.04);
  });

  it('penalises confident misses hard', () => {
    const s = scoreDirection('up', 0.9, 100, 95);
    expect(s.directionHit).toBe(false);
    expect(s.brier).toBeCloseTo(0.81);
  });

  it('treats flat as inside the band', () => {
    expect(scoreDirection('flat', 0.6, 100, 101).directionHit).toBe(true);
    expect(scoreDirection('flat', 0.6, 100, 104).directionHit).toBe(false);
  });
});

describe('excursions', () => {
  it('reports max favorable and adverse moves from entry', () => {
    const bars = [
      { h: 105, l: 98 },
      { h: 110, l: 101 },
      { h: 104, l: 95 },
    ] as Bar[];
    const e = excursions(100, bars);
    expect(e.maxFavorablePct).toBeCloseTo(10);
    expect(e.maxAdversePct).toBeCloseTo(-5);
  });

  it('returns nulls without bars', () => {
    expect(excursions(100, [])).toEqual({ maxFavorablePct: null, maxAdversePct: null });
  });
});

function pred(overrides: Partial<Prediction>): Prediction {
  return {
    symbol: 'X',
    createdAt: new Date(),
    dueAt: new Date(),
    status: 'scored',
    acted: true,
    action: 'BUY',
    trigger: 'morning_research',
    orderId: null,
    entryPrice: 100,
    direction: 'up',
    expectedMovePct: 5,
    horizonDays: 5,
    confidence: 0.7,
    conviction: 7,
    catalysts: [],
    invalidation: '',
    thesis: '',
    modelUsed: 'test',
    context: { news: [], indicators: { rsi: null, sma20: null, volumeVsAvg: null, priceChange5d: null, priceChange1m: null }, available: [], missing: [] },
    outcome: { scoredAt: new Date(), priceAtDue: 105, realizedMovePct: 5, directionHit: true, brier: 0.09, maxFavorablePct: null, maxAdversePct: null },
    ...overrides,
  };
}

describe('computeCalibration', () => {
  it('buckets by stated confidence and separates acted from passed', () => {
    const preds = [
      pred({ confidence: 0.75 }),
      pred({ confidence: 0.72, outcome: { ...pred({}).outcome!, directionHit: false, realizedMovePct: -3, brier: 0.5 } }),
      pred({ confidence: 0.92, acted: false, action: 'PASS', outcome: { ...pred({}).outcome!, realizedMovePct: 6 } }),
    ];
    const c = computeCalibration(preds);
    expect(c.n).toBe(3);
    const b7 = c.buckets.find((b) => b.range === '0.7-0.8')!;
    expect(b7.n).toBe(2);
    expect(b7.hitRate).toBeCloseTo(0.5);
    expect(c.acted.n).toBe(2);
    expect(c.passed.n).toBe(1);
    expect(c.passed.missedWinners).toBe(1);
    expect(c.byTrigger.morning_research.n).toBe(3);
  });

  it('handles an empty set', () => {
    const c = computeCalibration([]);
    expect(c.n).toBe(0);
    expect(c.hitRate).toBeNull();
    expect(c.meanBrier).toBeNull();
  });
});

describe('compareToBenchmark', () => {
  it('indexes both series to 100 and reports alpha', () => {
    const rows = [
      { date: '2026-09-01', equity: 100000, spyClose: 500, createdAt: new Date() },
      { date: '2026-09-02', equity: 102000, spyClose: 505, createdAt: new Date() },
      { date: '2026-09-03', equity: 103000, spyClose: 500, createdAt: new Date() },
    ];
    const c = compareToBenchmark(rows);
    expect(c.botReturnPct).toBeCloseTo(3);
    expect(c.spyReturnPct).toBeCloseTo(0);
    expect(c.alphaPct).toBeCloseTo(3);
    expect(c.series[1].botIdx).toBeCloseTo(102);
    expect(c.series[1].spyIdx).toBeCloseTo(101);
  });

  it('tolerates missing SPY closes', () => {
    const rows = [
      { date: '2026-09-01', equity: 100, spyClose: null, createdAt: new Date() },
      { date: '2026-09-02', equity: 110, spyClose: null, createdAt: new Date() },
    ];
    const c = compareToBenchmark(rows);
    expect(c.botReturnPct).toBeCloseTo(10);
    expect(c.spyReturnPct).toBeNull();
  });
});
