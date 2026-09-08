import { describe, it, expect } from 'vitest';
import { parseRecentFilings, formatFilings } from '../src/services/edgar/filings';
import { filterByLiquidity, UniverseEntry } from '../src/services/alpaca/screener';

describe('EDGAR filings', () => {
  it('keeps only forms of interest and splits 8-K item codes', () => {
    const filings = parseRecentFilings({
      form: ['8-K', '4', '10-Q', '8-K', 'S-8'],
      filingDate: ['2026-09-04', '2026-09-03', '2026-08-01', '2026-07-30', '2026-07-01'],
      items: ['2.02,9.01', '', '', '5.02', ''],
      primaryDocDescription: ['8-K', 'FORM 4', '10-Q', '8-K', 'S-8'],
      reportDate: ['2026-09-04', '', '2026-06-30', '2026-07-30', ''],
    });
    expect(filings.map((f) => f.form)).toEqual(['8-K', '10-Q', '8-K']);
    expect(filings[0].items).toEqual(['2.02', '9.01']);
    const lines = formatFilings(filings);
    expect(lines[0]).toBe('8-K 2026-09-04: earnings results (2.02)');
    expect(lines[1]).toBe('10-Q 2026-08-01: 10-Q');
    expect(lines[2]).toContain('officer/director change (5.02)');
  });
});

describe('filterByLiquidity', () => {
  const u = (symbol: string, source: UniverseEntry['source']): UniverseEntry => ({ symbol, sector: '', source, note: '' });

  it('never drops watchlist names but drops thin or cheap screener names', () => {
    const { kept, dropped } = filterByLiquidity(
      [u('AAPL', 'watchlist'), u('THIN', 'gainer'), u('CHEAP', 'loser'), u('GOOD', 'active'), u('NODATA', 'gainer')],
      {
        AAPL: { price: 1, dollarVolume: 0 },
        THIN: { price: 20, dollarVolume: 2_000_000 },
        CHEAP: { price: 3, dollarVolume: 90_000_000 },
        GOOD: { price: 40, dollarVolume: 80_000_000 },
      },
      5,
      25_000_000
    );
    expect(kept.map((x) => x.symbol)).toEqual(['AAPL', 'GOOD']);
    expect(dropped).toHaveLength(3);
  });
});
