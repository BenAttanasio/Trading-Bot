import { describe, it, expect } from 'vitest';
import { buildMarketContext, classifyRegime, formatMarketContext, sectorPerformanceLine, relativeStrength5d, snapshotFromBars } from '../src/services/alpaca/market-context';
import type { Bar } from '../src/services/alpaca/market-data';

function bars(closes: number[]): Bar[] {
  return closes.map((c, i) => ({ t: `2026-06-${String((i % 28) + 1).padStart(2, '0')}`, o: c, h: c + 1, l: c - 1, c, v: 1000, n: 1, vw: c }));
}

const rising = Array.from({ length: 60 }, (_, i) => 400 + i);
const falling = Array.from({ length: 60 }, (_, i) => 500 - i);

describe('market context', () => {
  it('classifies a rising SPY as risk-on and a falling one as risk-off', () => {
    expect(classifyRegime(snapshotFromBars('SPY', bars(rising)))).toBe('risk_on');
    expect(classifyRegime(snapshotFromBars('SPY', bars(falling)))).toBe('risk_off');
    expect(classifyRegime(undefined)).toBe('mixed');
  });

  it('builds sector lines and relative strength from bars', () => {
    const ctx = buildMarketContext({ SPY: bars(rising), QQQ: bars(rising), IWM: bars(falling), XLK: bars(rising), XLE: bars(falling) });
    expect(ctx.regime).toBe('risk_on');
    expect(ctx.sectors.map((s) => s.symbol).sort()).toEqual(['XLE', 'XLK']);
    expect(ctx.spyRealizedVolPct).toBeGreaterThan(0);
    const text = formatMarketContext(ctx);
    expect(text).toContain('regime: risk on');
    expect(text).toContain('XLK');
    expect(sectorPerformanceLine(ctx, 'Energy')).toContain('XLE');
    expect(sectorPerformanceLine(ctx, 'Unknown Sector')).toContain('SPY');
    const spy5 = ctx.indices.find((i) => i.symbol === 'SPY')!.change5dPct!;
    expect(relativeStrength5d(ctx, spy5 + 2)).toBeCloseTo(2);
    expect(relativeStrength5d(ctx, null)).toBeNull();
  });

  it('degrades gracefully with no bars', () => {
    const ctx = buildMarketContext({});
    expect(ctx.regime).toBe('mixed');
    expect(formatMarketContext({ ...ctx, indices: [] })).toContain('unavailable');
  });
});
