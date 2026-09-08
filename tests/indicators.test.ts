import { describe, it, expect } from 'vitest';
import { calculateRSI, calculateSMA, calculateVolumeAverage, calculateATR, calculateRealizedVol, Bar } from '../src/services/alpaca/market-data';

function bars(closes: number[], volume = 1000): Bar[] {
  return closes.map((c, i) => ({ t: `2026-01-${String(i + 1).padStart(2, '0')}`, o: c, h: c, l: c, c, v: volume } as unknown as Bar));
}

describe('calculateRSI', () => {
  it('returns 50 when there is not enough data', () => {
    expect(calculateRSI(bars([1, 2, 3]))).toBe(50);
  });

  it('returns 100 for a series that only rises', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(calculateRSI(bars(closes))).toBe(100);
  });

  it('returns ~0 for a series that only falls', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 200 - i);
    expect(calculateRSI(bars(closes))).toBeLessThan(1);
  });

  it('is between 0 and 100 for a mixed series', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const rsi = calculateRSI(bars(closes));
    expect(rsi).toBeGreaterThan(0);
    expect(rsi).toBeLessThan(100);
  });
});

describe('calculateSMA', () => {
  it('averages the last N closes', () => {
    expect(calculateSMA(bars([1, 2, 3, 4, 5, 6]), 3)).toBe(5);
  });

  it('falls back to the last close when there is not enough data', () => {
    expect(calculateSMA(bars([7, 9]), 5)).toBe(9);
  });
});

describe('calculateATR', () => {
  it('returns 0 without enough bars', () => {
    expect(calculateATR(bars([1, 2, 3]))).toBe(0);
  });

  it('equals the constant true range for a flat series with a fixed high-low spread', () => {
    const b = Array.from({ length: 20 }, (_, i) => ({ t: `2026-01-${String(i + 1).padStart(2, '0')}`, o: 100, h: 102, l: 98, c: 100, v: 1 } as unknown as Bar));
    expect(calculateATR(b)).toBeCloseTo(4);
  });
});

describe('calculateRealizedVol', () => {
  it('is 0 for a flat series and positive for a noisy one', () => {
    expect(calculateRealizedVol(bars(Array(25).fill(100)))).toBe(0);
    expect(calculateRealizedVol(bars(Array.from({ length: 25 }, (_, i) => 100 + (i % 2 ? 3 : -3))))).toBeGreaterThan(10);
  });
});

describe('calculateVolumeAverage', () => {
  it('averages the last N volumes', () => {
    const b = bars([1, 1, 1, 1], 0).map((bar, i) => ({ ...bar, v: (i + 1) * 100 }));
    expect(calculateVolumeAverage(b, 2)).toBe(350);
  });
});
