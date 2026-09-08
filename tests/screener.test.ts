import { describe, it, expect } from 'vitest';
import { mergeUniverse } from '../src/services/alpaca/screener';

const watchlist = [
  { symbol: 'AAPL', sector: 'Technology' },
  { symbol: 'MSFT', sector: 'Technology' },
];

describe('mergeUniverse', () => {
  it('always keeps the watchlist and interleaves screener sources', () => {
    const u = mergeUniverse({
      watchlist,
      gainers: [{ symbol: 'GNRA', percent_change: 12, change: 1, price: 20 }, { symbol: 'GNRB', percent_change: 9, change: 1, price: 30 }],
      losers: [{ symbol: 'LSRA', percent_change: -11, change: -1, price: 15 }],
      actives: [{ symbol: 'ACTA', volume: 50_000_000, trade_count: 1 }],
      maxCandidates: 5,
      minPrice: 5,
    });
    expect(u.map((x) => x.symbol)).toEqual(['AAPL', 'MSFT', 'GNRA', 'LSRA', 'ACTA']);
    expect(u[2].source).toBe('gainer');
    expect(u[3].source).toBe('loser');
  });

  it('drops warrants, units, penny names, duplicates and excluded symbols', () => {
    const u = mergeUniverse({
      watchlist,
      gainers: [
        { symbol: 'ABC.WS', percent_change: 40, change: 1, price: 2 },
        { symbol: 'AAPL', percent_change: 3, change: 1, price: 200 },
        { symbol: 'PENY', percent_change: 50, change: 1, price: 1.2 },
        { symbol: 'SPY', percent_change: 1, change: 1, price: 500 },
        { symbol: 'GOOD', percent_change: 8, change: 1, price: 40 },
      ],
      losers: [],
      actives: [],
      maxCandidates: 10,
      minPrice: 5,
      exclude: ['SPY'],
    });
    expect(u.map((x) => x.symbol)).toEqual(['AAPL', 'MSFT', 'GOOD']);
  });

  it('never truncates the watchlist even when it exceeds the cap', () => {
    const big = Array.from({ length: 8 }, (_, i) => ({ symbol: `W${i}`, sector: '' }));
    const u = mergeUniverse({ watchlist: big, gainers: [{ symbol: 'GNR', percent_change: 5, change: 1, price: 10 }], losers: [], actives: [], maxCandidates: 4, minPrice: 5 });
    expect(u).toHaveLength(8);
    expect(u.every((x) => x.source === 'watchlist')).toBe(true);
  });
});
