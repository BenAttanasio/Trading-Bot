import { describe, it, expect } from 'vitest';
import { resolveStop, resolveTarget, calibrationMultiplier, sizePosition } from '../src/engine/sizing';

describe('resolveStop', () => {
  it('uses the decision stop when it is on the losing side and within bounds', () => {
    const s = resolveStop({ price: 100, side: 'long', proposedStop: 95, atr: 2, atrMultiple: 2 });
    expect(s.source).toBe('decision');
    expect(s.stopPrice).toBe(95);
    expect(s.stopDistancePct).toBeCloseTo(5);
  });

  it('rejects a long stop above price and falls back to ATR', () => {
    const s = resolveStop({ price: 100, side: 'long', proposedStop: 105, atr: 2, atrMultiple: 2 });
    expect(s.source).toBe('atr');
    expect(s.stopPrice).toBe(96);
  });

  it('puts a short stop above price', () => {
    const s = resolveStop({ price: 100, side: 'short', proposedStop: null, atr: 1.5, atrMultiple: 2 });
    expect(s.stopPrice).toBe(103);
    expect(s.stopDistancePct).toBeCloseTo(3);
  });

  it('caps an ATR stop at the max distance and rejects a decision stop that is too wide', () => {
    const wide = resolveStop({ price: 100, side: 'long', proposedStop: 70, atr: 20, atrMultiple: 2, maxStopPct: 15 });
    expect(wide.source).toBe('atr');
    expect(wide.stopPrice).toBe(85);
  });

  it('falls back to 5% with no usable stop and no ATR', () => {
    const s = resolveStop({ price: 50, side: 'long', proposedStop: null, atr: null, atrMultiple: 2 });
    expect(s.source).toBe('fallback');
    expect(s.stopPrice).toBe(47.5);
  });
});

describe('resolveTarget', () => {
  it('keeps a target on the winning side', () => {
    expect(resolveTarget(100, 'long', 112, 5)).toBe(112);
    expect(resolveTarget(100, 'short', 90, 5)).toBe(90);
  });

  it('replaces a wrong-side target with reward-ratio × stop distance', () => {
    expect(resolveTarget(100, 'long', 90, 5)).toBe(110);
    expect(resolveTarget(100, 'short', 120, 4, 2)).toBe(92);
  });
});

describe('calibrationMultiplier', () => {
  it('is 1 without enough samples', () => {
    expect(calibrationMultiplier({ n: 5, hitRate: 0.9 }, 30)).toBe(1);
    expect(calibrationMultiplier(null, 30)).toBe(1);
  });

  it('scales with measured hit rate and stays bounded', () => {
    expect(calibrationMultiplier({ n: 50, hitRate: 0.55 }, 30)).toBeCloseTo(1);
    expect(calibrationMultiplier({ n: 50, hitRate: 0.65 }, 30)).toBeCloseTo(1.5);
    expect(calibrationMultiplier({ n: 50, hitRate: 0.3 }, 30)).toBe(0.25);
  });
});

describe('sizePosition', () => {
  const base = {
    equity: 100_000,
    price: 50,
    side: 'long' as const,
    stopDistancePct: 5,
    riskPerTradePercent: 0.5,
    maxPositionDollars: 100_000,
    hardMaxPositionPct: 25,
    minScoredForCalibration: 30,
    wholeShares: false,
  };

  it('sizes so that the stop loses exactly the risk budget', () => {
    const r = sizePosition(base);
    expect(r.riskDollars).toBe(500);
    expect(r.notional).toBeCloseTo(10_000, 0);
    expect(r.cappedBy).toBe('risk');
  });

  it('caps at the configured max position', () => {
    const r = sizePosition({ ...base, maxPositionDollars: 50 });
    expect(r.notional).toBe(50);
    expect(r.cappedBy).toBe('maxPosition');
  });

  it('caps at the hard % of equity even when the max position allows more', () => {
    const r = sizePosition({ ...base, stopDistancePct: 0.5 }); // by risk: $100k
    expect(r.notional).toBe(25_000);
    expect(r.cappedBy).toBe('hardLimit');
  });

  it('rounds to whole shares for shorts and refuses sub-share sizes', () => {
    const ok = sizePosition({ ...base, side: 'short', wholeShares: true, maxPositionDollars: 175 });
    expect(ok.qty).toBe(3);
    expect(ok.notional).toBe(150);
    const tooSmall = sizePosition({ ...base, side: 'short', wholeShares: true, maxPositionDollars: 40 });
    expect(tooSmall.qty).toBe(0);
    expect(tooSmall.notional).toBe(0);
    expect(tooSmall.cappedBy).toBe('lot');
  });
});
