import { getBarsMulti, calculateSMA, calculateRealizedVol, Bar } from './market-data';
import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('MarketContext');

/**
 * What the market is doing today, so no symbol is judged in a vacuum: index
 * trend, breadth proxies, realized vol, and sector ETF performance.
 */

export const INDEX_ETFS = ['SPY', 'QQQ', 'IWM'] as const;

export const SECTOR_ETFS: Record<string, string> = {
  Technology: 'XLK',
  Consumer: 'XLY',
  'Consumer Discretionary': 'XLY',
  'Consumer Staples': 'XLP',
  Healthcare: 'XLV',
  'Health Care': 'XLV',
  Finance: 'XLF',
  Financials: 'XLF',
  Energy: 'XLE',
  Industrials: 'XLI',
  Materials: 'XLB',
  Utilities: 'XLU',
  'Real Estate': 'XLRE',
  Communication: 'XLC',
  'Communication Services': 'XLC',
  Semiconductors: 'SMH',
};

export interface EtfSnapshot {
  symbol: string;
  price: number;
  change1dPct: number | null;
  change5dPct: number | null;
  change1mPct: number | null;
  aboveSma20: boolean | null;
  aboveSma50: boolean | null;
}

export interface MarketContext {
  asOf: Date;
  indices: EtfSnapshot[];
  sectors: EtfSnapshot[];
  /** SPY 20-day realized vol, annualized %. Cheap VIX proxy. */
  spyRealizedVolPct: number | null;
  regime: 'risk_on' | 'risk_off' | 'mixed';
}

function pctChange(bars: Bar[], back: number): number | null {
  if (bars.length <= back) return null;
  const last = bars[bars.length - 1].c;
  const prev = bars[bars.length - 1 - back].c;
  return prev > 0 ? ((last - prev) / prev) * 100 : null;
}

/** Pure: build a snapshot from daily bars (last bar = most recent close or today's partial). */
export function snapshotFromBars(symbol: string, bars: Bar[]): EtfSnapshot {
  const last = bars[bars.length - 1];
  return {
    symbol,
    price: last?.c ?? 0,
    change1dPct: pctChange(bars, 1),
    change5dPct: pctChange(bars, 5),
    change1mPct: pctChange(bars, 21),
    aboveSma20: bars.length >= 20 ? last.c > calculateSMA(bars, 20) : null,
    aboveSma50: bars.length >= 50 ? last.c > calculateSMA(bars, 50) : null,
  };
}

/** Pure: crude regime call from SPY trend + short-term momentum. */
export function classifyRegime(spy: EtfSnapshot | undefined): MarketContext['regime'] {
  if (!spy) return 'mixed';
  const trendUp = spy.aboveSma20 === true && spy.aboveSma50 !== false;
  const trendDown = spy.aboveSma20 === false && spy.aboveSma50 !== true;
  const momUp = (spy.change5dPct ?? 0) > 0;
  if (trendUp && momUp) return 'risk_on';
  if (trendDown && !momUp) return 'risk_off';
  return 'mixed';
}

export function buildMarketContext(barsBySymbol: Record<string, Bar[]>, asOf = new Date()): MarketContext {
  const indices = INDEX_ETFS.map((s) => snapshotFromBars(s, barsBySymbol[s] ?? []));
  const sectorSymbols = Array.from(new Set(Object.values(SECTOR_ETFS)));
  const sectors = sectorSymbols
    .filter((s) => (barsBySymbol[s] ?? []).length > 0)
    .map((s) => snapshotFromBars(s, barsBySymbol[s]));
  const spyBars = barsBySymbol.SPY ?? [];
  const spy = indices.find((i) => i.symbol === 'SPY');
  return {
    asOf,
    indices,
    sectors,
    spyRealizedVolPct: spyBars.length >= 3 ? calculateRealizedVol(spyBars, 20) : null,
    regime: classifyRegime(spy),
  };
}

let cached: { ctx: MarketContext; at: number } | null = null;
const CACHE_MS = 15 * 60 * 1000;

/** Fetch (cached 15 min). Never throws — returns an empty context on failure. */
export async function getMarketContext(end?: string): Promise<MarketContext> {
  if (!end && cached && Date.now() - cached.at < CACHE_MS) return cached.ctx;
  const symbols = [...INDEX_ETFS, ...Array.from(new Set(Object.values(SECTOR_ETFS)))];
  try {
    const bars = await getBarsMulti(symbols, '1Day', 60, end);
    const ctx = buildMarketContext(bars);
    if (!end) cached = { ctx, at: Date.now() };
    return ctx;
  } catch (error) {
    log.warn('Market context unavailable', { error });
    return { asOf: new Date(), indices: [], sectors: [], spyRealizedVolPct: null, regime: 'mixed' };
  }
}

const fmt = (v: number | null) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);

/** Compact prompt block. Volatile (changes daily) — goes in the user prompt, never the cached prefix. */
export function formatMarketContext(ctx: MarketContext): string {
  if (ctx.indices.length === 0) return 'MARKET CONTEXT: unavailable';
  const idx = ctx.indices
    .map((i) => `${i.symbol} 1d ${fmt(i.change1dPct)}, 5d ${fmt(i.change5dPct)}, 1m ${fmt(i.change1mPct)}, ${i.aboveSma20 == null ? '' : i.aboveSma20 ? 'above' : 'below'} SMA20${i.aboveSma50 == null ? '' : i.aboveSma50 ? ', above SMA50' : ', below SMA50'}`)
    .join('\n  ');
  const sectors = [...ctx.sectors]
    .sort((a, b) => (b.change5dPct ?? 0) - (a.change5dPct ?? 0))
    .map((s) => `${s.symbol} ${fmt(s.change5dPct)} (1m ${fmt(s.change1mPct)})`)
    .join(', ');
  return `MARKET CONTEXT (regime: ${ctx.regime.replace('_', ' ')}; SPY 20d realized vol ${ctx.spyRealizedVolPct == null ? 'n/a' : ctx.spyRealizedVolPct.toFixed(0) + '%'}):
  ${idx}
  Sector ETFs by 5d strength: ${sectors || 'n/a'}`;
}

/** One-line sector performance for a position review. */
export function sectorPerformanceLine(ctx: MarketContext, sector: string): string {
  const etf = SECTOR_ETFS[sector];
  const snap = etf ? ctx.sectors.find((s) => s.symbol === etf) : undefined;
  const spy = ctx.indices.find((i) => i.symbol === 'SPY');
  if (!snap) return spy ? `SPY 5d ${fmt(spy.change5dPct)} (sector ETF unknown)` : 'unknown';
  return `${etf} 5d ${fmt(snap.change5dPct)}, 1m ${fmt(snap.change1mPct)} vs SPY 5d ${fmt(spy?.change5dPct ?? null)}`;
}

/** Relative strength of a symbol vs SPY over 5 days (percentage points), or null. */
export function relativeStrength5d(ctx: MarketContext, change5dPct: number | null): number | null {
  const spy = ctx.indices.find((i) => i.symbol === 'SPY');
  if (change5dPct == null || spy?.change5dPct == null) return null;
  return change5dPct - spy.change5dPct;
}
