import { getSnapshot, getBars, calculateRSI, calculateSMA, calculateVolumeAverage, calculateATR, Bar, Snapshot } from './market-data';
import { getNewsForSymbol, getNews, AlpacaNewsItem } from './news';
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
  priceChange1d: number | null;
  priceChange5d: number | null;
  priceChange1m: number | null;
  /** ATR(14) in dollars and as % of price — the unit for stops and sizing. */
  atr: number | null;
  atrPct: number | null;
  // News
  news: AlpacaNewsItem[];
  // What's available vs missing — for logging and prompt context
  available: string[];
  missing: string[];
}

export interface GatherOptions {
  newsLimit?: number;
  /**
   * Replay mode: ISO date. Bars and news are fetched up to this instant and no
   * snapshot is used, so nothing after `asOf` leaks into the decision.
   */
  asOf?: string;
  /** Pre-fetched daily bars (batch gathering) — skips the per-symbol bars request. */
  bars?: Bar[];
}

/** Pure: derive every indicator from bars + optional snapshot. Shared by live and replay paths. */
export function deriveIndicators(symbol: string, bars: Bar[], snapshot: Snapshot | null, news: AlpacaNewsItem[]): GatheredMarketData {
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
  let priceChange1d: number | null = null;
  let priceChange5d: number | null = null;
  let priceChange1m: number | null = null;
  let atr: number | null = null;
  let atrPct: number | null = null;

  if (bars.length >= 15) {
    rsi = calculateRSI(bars);
    available.push(`RSI(14) from ${bars.length} bars`);
    atr = calculateATR(bars);
    atrPct = currentPrice > 0 ? (atr / currentPrice) * 100 : null;
    available.push('ATR(14)');
  } else {
    missing.push(`RSI/ATR (need 15+ bars, have ${bars.length})`);
  }

  if (bars.length >= 20) {
    sma20 = calculateSMA(bars, 20);
    available.push('SMA(20)');
  } else if (bars.length >= 5) {
    sma20 = calculateSMA(bars, bars.length);
    available.push(`SMA(${bars.length}) — short-window fallback`);
  } else {
    missing.push(`SMA (need 5+ bars, have ${bars.length})`);
  }

  if (bars.length >= 5) {
    const volumeAvg = calculateVolumeAverage(bars, Math.min(20, bars.length));
    const currentVolume = dailyBar?.v ?? bars[bars.length - 1].v;
    volumeVsAvg = volumeAvg > 0 ? currentVolume / volumeAvg : null;
    available.push(`volume vs avg (${Math.min(20, bars.length)}-day window)`);
  } else if (snapshot?.dailyBar && snapshot?.prevDailyBar) {
    const todayVol = snapshot.dailyBar.v;
    const prevVol = snapshot.prevDailyBar.v;
    volumeVsAvg = prevVol > 0 ? todayVol / prevVol : null;
    available.push('volume vs yesterday (snapshot)');
  } else {
    missing.push('volume comparison');
  }

  const refClose = prevDailyBar?.c ?? (bars.length >= 2 ? bars[bars.length - 2].c : null);
  if (refClose && currentPrice > 0) {
    priceChange1d = ((currentPrice - refClose) / refClose) * 100;
    available.push('1-day price change');
  }

  if (bars.length >= 5) {
    const price5dAgo = bars[bars.length - 5].c;
    priceChange5d = ((currentPrice - price5dAgo) / price5dAgo) * 100;
    available.push('5-day price change');
  } else if (prevDailyBar && currentPrice) {
    priceChange5d = ((currentPrice - prevDailyBar.c) / prevDailyBar.c) * 100;
    available.push('1-day price change (snapshot fallback for 5d)');
  } else {
    missing.push('5-day price change');
  }

  if (bars.length >= 20) {
    const price1mAgo = bars[Math.max(0, bars.length - 21)].c;
    priceChange1m = ((currentPrice - price1mAgo) / price1mAgo) * 100;
    available.push('1-month price change');
  } else {
    missing.push('1-month price change');
  }

  if (news.length > 0) {
    available.push(`${news.length} news items`);
  } else {
    missing.push('news');
  }

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
    priceChange1d,
    priceChange5d,
    priceChange1m,
    atr,
    atrPct,
    news,
    available,
    missing,
  };
}

export async function gatherMarketData(symbol: string, options: GatherOptions | number = {}): Promise<GatheredMarketData> {
  const opts: GatherOptions = typeof options === 'number' ? { newsLimit: options } : options;
  const newsLimit = opts.newsLimit ?? 10;
  const asOf = opts.asOf;

  // Fetch everything in parallel — each catches its own errors
  const [snapshotResult, barsResult, newsResult] = await Promise.all([
    asOf
      ? Promise.resolve(null)
      : getSnapshot(symbol).catch((err) => {
          log.warn(`Snapshot unavailable for ${symbol}: ${err.message}`);
          return null;
        }),
    opts.bars
      ? Promise.resolve({ bars: opts.bars })
      : getBars(symbol, '1Day', 30, undefined, asOf).catch((err) => {
          log.warn(`Historical bars unavailable for ${symbol}: ${err.message}`);
          return { bars: [] as Bar[] };
        }),
    (newsLimit <= 0
      ? Promise.resolve([] as AlpacaNewsItem[])
      : asOf
        ? getNews([symbol], newsLimit, new Date(new Date(asOf).getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(), asOf)
        : getNewsForSymbol(symbol, newsLimit)
    ).catch((err) => {
      log.warn(`News unavailable for ${symbol}: ${err.message}`);
      return [] as AlpacaNewsItem[];
    }),
  ]);

  const data = deriveIndicators(symbol, barsResult.bars ?? [], snapshotResult, newsResult);

  log.info(`Data gathered for ${symbol}: ${data.barCount} bars, price=$${data.currentPrice.toFixed(2)} (${data.priceSource})`, {
    available: data.available.join(', '),
    missing: data.missing.length > 0 ? data.missing.join(', ') : 'none',
  });

  return data;
}

/** Gather many symbols with bounded concurrency (Alpaca rate limit is 200 req/min). */
export async function gatherMany(
  symbols: string[],
  options: GatherOptions & { concurrency?: number; barsBySymbol?: Record<string, Bar[]> } = {}
): Promise<Map<string, GatheredMarketData>> {
  const out = new Map<string, GatheredMarketData>();
  const concurrency = Math.max(1, options.concurrency ?? 5);
  const queue = [...symbols];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const sym = queue.shift()!;
      try {
        const data = await gatherMarketData(sym, { ...options, bars: options.barsBySymbol?.[sym] ?? options.bars });
        if (data.currentPrice > 0) out.set(sym, data);
        else log.warn(`No price for ${sym} — dropped from candidates`);
      } catch (error) {
        log.warn(`Gather failed for ${sym}`, { error });
      }
    }
  });
  await Promise.all(workers);
  return out;
}
