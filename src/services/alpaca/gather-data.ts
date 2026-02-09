import { getSnapshot, getBars, calculateRSI, calculateSMA, calculateVolumeAverage, Bar, Snapshot } from './market-data';
import { getNewsForSymbol, AlpacaNewsItem } from './news';
import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('MarketData');

/**
 * Everything we know about a symbol right now.
 * Fields are nullable — callers and prompts must handle missing data.
 */
export interface GatheredMarketData {
  symbol: string;
  // Price — at least one source will be available
  currentPrice: number;
  priceSource: 'snapshot' | 'daily_bar' | 'none';
  // Snapshot data (always available during extended hours)
  snapshot: Snapshot | null;
  dailyBar: Bar | null;
  prevDailyBar: Bar | null;
  // Historical bars (may be empty during after-hours)
  bars: Bar[];
  barCount: number;
  // Computed indicators (null if insufficient data)
  rsi: number | null;
  sma20: number | null;
  volumeVsAvg: number | null;
  priceChange5d: number | null;
  priceChange1m: number | null;
  // News
  news: AlpacaNewsItem[];
  // What's available vs missing — for logging and prompt context
  available: string[];
  missing: string[];
}

export async function gatherMarketData(symbol: string, newsLimit: number = 10): Promise<GatheredMarketData> {
  // Fetch everything in parallel — each catches its own errors
  const [snapshotResult, barsResult, newsResult] = await Promise.all([
    getSnapshot(symbol).catch((err) => {
      log.warn(`Snapshot unavailable for ${symbol}: ${err.message}`);
      return null;
    }),
    getBars(symbol, '1Day', 30).catch((err) => {
      log.warn(`Historical bars unavailable for ${symbol}: ${err.message}`);
      return { bars: [] as Bar[] };
    }),
    getNewsForSymbol(symbol, newsLimit).catch((err) => {
      log.warn(`News unavailable for ${symbol}: ${err.message}`);
      return [] as AlpacaNewsItem[];
    }),
  ]);

  const bars = barsResult.bars;
  const snapshot = snapshotResult;
  const available: string[] = [];
  const missing: string[] = [];

  // ─── Resolve current price ─────────────────────────
  let currentPrice = 0;
  let priceSource: 'snapshot' | 'daily_bar' | 'none' = 'none';

  if (snapshot?.latestTrade?.p) {
    currentPrice = snapshot.latestTrade.p;
    priceSource = 'snapshot';
    available.push('snapshot (latest trade)');
  } else if (bars.length > 0) {
    currentPrice = bars[bars.length - 1].c;
    priceSource = 'daily_bar';
    available.push('last daily bar close');
  } else {
    missing.push('current price (no snapshot or bars)');
  }

  // ─── Snapshot-derived data ─────────────────────────
  const dailyBar = snapshot?.dailyBar || null;
  const prevDailyBar = snapshot?.prevDailyBar || null;

  if (snapshot) {
    available.push('quote (bid/ask)');
    if (dailyBar) available.push('today daily bar');
    if (prevDailyBar) available.push('previous daily bar');
  } else {
    missing.push('snapshot');
  }

  // ─── Historical indicators ─────────────────────────
  let rsi: number | null = null;
  let sma20: number | null = null;
  let volumeVsAvg: number | null = null;
  let priceChange5d: number | null = null;
  let priceChange1m: number | null = null;

  if (bars.length >= 15) {
    rsi = calculateRSI(bars);
    available.push(`RSI(14) from ${bars.length} bars`);
  } else {
    missing.push(`RSI (need 15+ bars, have ${bars.length})`);
  }

  if (bars.length >= 20) {
    sma20 = calculateSMA(bars, 20);
    available.push('SMA(20)');
  } else if (bars.length >= 5) {
    // Compute a shorter SMA as fallback
    sma20 = calculateSMA(bars, bars.length);
    available.push(`SMA(${bars.length}) — short-window fallback`);
  } else {
    missing.push(`SMA (need 5+ bars, have ${bars.length})`);
  }

  if (bars.length >= 5) {
    const volumeAvg = calculateVolumeAverage(bars, Math.min(20, bars.length));
    const currentVolume = bars[bars.length - 1].v;
    volumeVsAvg = volumeAvg > 0 ? currentVolume / volumeAvg : null;
    available.push(`volume vs avg (${Math.min(20, bars.length)}-day window)`);
  } else if (snapshot?.dailyBar && snapshot?.prevDailyBar) {
    // Use snapshot daily bars for a rough volume comparison
    const todayVol = snapshot.dailyBar.v;
    const prevVol = snapshot.prevDailyBar.v;
    volumeVsAvg = prevVol > 0 ? todayVol / prevVol : null;
    available.push('volume vs yesterday (snapshot)');
  } else {
    missing.push('volume comparison');
  }

  if (bars.length >= 5) {
    const price5dAgo = bars[bars.length - 5].c;
    priceChange5d = ((currentPrice - price5dAgo) / price5dAgo) * 100;
    available.push('5-day price change');
  } else if (prevDailyBar && currentPrice) {
    // Use snapshot prev bar as 1-day proxy
    priceChange5d = ((currentPrice - prevDailyBar.c) / prevDailyBar.c) * 100;
    available.push('1-day price change (snapshot fallback for 5d)');
  } else {
    missing.push('5-day price change');
  }

  if (bars.length >= 20) {
    const price1mAgo = bars[0].c;
    priceChange1m = ((currentPrice - price1mAgo) / price1mAgo) * 100;
    available.push('1-month price change');
  } else {
    missing.push('1-month price change');
  }

  // ─── News ──────────────────────────────────────────
  if (newsResult.length > 0) {
    available.push(`${newsResult.length} news items`);
  } else {
    missing.push('news');
  }

  // ─── Log data availability ─────────────────────────
  log.info(`Data gathered for ${symbol}: ${bars.length} bars, price=$${currentPrice.toFixed(2)} (${priceSource})`, {
    available: available.join(', '),
    missing: missing.length > 0 ? missing.join(', ') : 'none',
  });

  return {
    symbol,
    currentPrice,
    priceSource,
    snapshot,
    dailyBar,
    prevDailyBar,
    bars,
    barCount: bars.length,
    rsi,
    sma20,
    volumeVsAvg,
    priceChange5d,
    priceChange1m,
    news: newsResult,
    available,
    missing,
  };
}
