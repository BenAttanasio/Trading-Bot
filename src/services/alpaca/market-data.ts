import { alpacaRequest } from './client';

// ─── Types ───────────────────────────────────────────────

export interface Bar {
  t: string;   // timestamp
  o: number;   // open
  h: number;   // high
  l: number;   // low
  c: number;   // close
  v: number;   // volume
  n: number;   // trade count
  vw: number;  // VWAP
}

export interface Snapshot {
  latestTrade: {
    t: string;
    x: string;
    p: number;
    s: number;
  };
  latestQuote: {
    t: string;
    ax: string;
    ap: number;
    as: number;
    bx: string;
    bp: number;
    bs: number;
  };
  minuteBar: Bar;
  dailyBar: Bar;
  prevDailyBar: Bar;
}

export interface MarketCalendarDay {
  date: string;
  open: string;
  close: string;
}

// ─── Market Data ─────────────────────────────────────────

export async function getSnapshot(symbol: string): Promise<Snapshot> {
  return alpacaRequest<Snapshot>(`/v2/stocks/${symbol}/snapshot`, {
    useDataUrl: true,
  });
}

export async function getSnapshots(symbols: string[]): Promise<Record<string, Snapshot>> {
  return alpacaRequest<Record<string, Snapshot>>('/v2/stocks/snapshots', {
    useDataUrl: true,
    params: { symbols: symbols.join(',') },
  });
}

export async function getBars(
  symbol: string,
  timeframe: string = '1Day',
  limit: number = 20,
  start?: string,
  end?: string
): Promise<{ bars: Bar[] }> {
  const params: Record<string, string> = {
    timeframe,
    limit: limit.toString(),
  };
  // Alpaca defaults `start` to the beginning of the current day, which returns a
  // single bar and silently disables every indicator. Reach back far enough
  // (calendar days ≈ 1.6× trading days, plus a buffer) to actually fill `limit`.
  if (!start && timeframe.endsWith('Day')) {
    const days = Math.ceil(limit * 1.6) + 7;
    start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  if (start) params.start = start;
  if (end) params.end = end;

  return alpacaRequest<{ bars: Bar[] }>(`/v2/stocks/${symbol}/bars`, {
    useDataUrl: true,
    params,
  });
}

export async function getLatestPrice(symbol: string): Promise<number> {
  const snapshot = await getSnapshot(symbol);
  return snapshot.latestTrade.p;
}

export async function getLatestPrices(symbols: string[]): Promise<Record<string, number>> {
  const snapshots = await getSnapshots(symbols);
  const prices: Record<string, number> = {};
  for (const [symbol, snap] of Object.entries(snapshots)) {
    prices[symbol] = snap.latestTrade.p;
  }
  return prices;
}

// ─── Market Calendar ─────────────────────────────────────

export async function getMarketCalendar(
  start?: string,
  end?: string
): Promise<MarketCalendarDay[]> {
  const params: Record<string, string> = {};
  if (start) params.start = start;
  if (end) params.end = end;

  return alpacaRequest<MarketCalendarDay[]>('/v2/calendar', { params });
}

export async function isMarketOpenToday(): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  const calendar = await getMarketCalendar(today, today);
  return calendar.length > 0;
}

// ─── Computed Indicators ─────────────────────────────────

export function calculateRSI(bars: Bar[], period: number = 14): number {
  if (bars.length < period + 1) return 50; // not enough data

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = bars[i].c - bars[i - 1].c;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < bars.length; i++) {
    const change = bars[i].c - bars[i - 1].c;
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calculateSMA(bars: Bar[], period: number): number {
  if (bars.length < period) return bars[bars.length - 1]?.c || 0;
  const slice = bars.slice(-period);
  return slice.reduce((sum, b) => sum + b.c, 0) / period;
}

export function calculateVolumeAverage(bars: Bar[], period: number = 20): number {
  if (bars.length < period) return bars.reduce((s, b) => s + b.v, 0) / bars.length;
  const slice = bars.slice(-period);
  return slice.reduce((sum, b) => sum + b.v, 0) / period;
}
