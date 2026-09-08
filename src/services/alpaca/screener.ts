import { alpacaRequest } from './client';
import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('Screener');

/**
 * Dynamic universe: the watchlist is the core, Alpaca's movers and most-actives
 * screener widens it to where the action actually is today.
 */

export interface Mover {
  symbol: string;
  percent_change: number;
  change: number;
  price: number;
}

export interface MostActive {
  symbol: string;
  volume: number;
  trade_count: number;
}

export async function getTopMovers(top = 20): Promise<{ gainers: Mover[]; losers: Mover[] }> {
  try {
    const res = await alpacaRequest<{ gainers: Mover[]; losers: Mover[] }>('/v1beta1/screener/stocks/movers', {
      useDataUrl: true,
      params: { top: String(top) },
    });
    return { gainers: res.gainers ?? [], losers: res.losers ?? [] };
  } catch (error) {
    log.warn('Movers screener unavailable', { error });
    return { gainers: [], losers: [] };
  }
}

export async function getMostActives(top = 20, by: 'volume' | 'trades' = 'volume'): Promise<MostActive[]> {
  try {
    const res = await alpacaRequest<{ most_actives: MostActive[] }>('/v1beta1/screener/stocks/most-actives', {
      useDataUrl: true,
      params: { top: String(top), by },
    });
    return res.most_actives ?? [];
  } catch (error) {
    log.warn('Most-actives screener unavailable', { error });
    return [];
  }
}

export interface UniverseEntry {
  symbol: string;
  sector: string;
  source: 'watchlist' | 'gainer' | 'loser' | 'active';
  note: string;
}

export interface UniverseInputs {
  watchlist: Array<{ symbol: string; sector: string }>;
  gainers: Mover[];
  losers: Mover[];
  actives: MostActive[];
  maxCandidates: number;
  minPrice: number;
  /** Symbols to leave out of the screener additions (already held, ETFs, etc.). */
  exclude?: string[];
}

const PLAIN_SYMBOL = /^[A-Z]{1,5}$/;

/**
 * Pure merge: watchlist first (always kept), then screener names interleaved
 * gainer / loser / active so no one source dominates, capped at maxCandidates.
 * Warrants/units/preferreds (dots, dashes) and sub-minPrice names are dropped.
 */
export function mergeUniverse(input: UniverseInputs): UniverseEntry[] {
  const out: UniverseEntry[] = [];
  const seen = new Set<string>();
  const excluded = new Set((input.exclude ?? []).map((s) => s.toUpperCase()));

  for (const w of input.watchlist) {
    const sym = w.symbol.toUpperCase();
    if (seen.has(sym)) continue;
    seen.add(sym);
    out.push({ symbol: sym, sector: w.sector, source: 'watchlist', note: 'watchlist' });
  }

  const gainers = input.gainers
    .filter((m) => PLAIN_SYMBOL.test(m.symbol) && m.price >= input.minPrice)
    .map<UniverseEntry>((m) => ({ symbol: m.symbol, sector: '', source: 'gainer', note: `top gainer ${m.percent_change >= 0 ? '+' : ''}${m.percent_change.toFixed(1)}% today` }));
  const losers = input.losers
    .filter((m) => PLAIN_SYMBOL.test(m.symbol) && m.price >= input.minPrice)
    .map<UniverseEntry>((m) => ({ symbol: m.symbol, sector: '', source: 'loser', note: `top loser ${m.percent_change.toFixed(1)}% today` }));
  const actives = input.actives
    .filter((m) => PLAIN_SYMBOL.test(m.symbol))
    .map<UniverseEntry>((m) => ({ symbol: m.symbol, sector: '', source: 'active', note: `most active (${(m.volume / 1e6).toFixed(1)}M shares)` }));

  const queues = [gainers, losers, actives];
  let progressed = true;
  while (out.length < input.maxCandidates && progressed) {
    progressed = false;
    for (const q of queues) {
      while (q.length) {
        const cand = q.shift()!;
        if (seen.has(cand.symbol) || excluded.has(cand.symbol)) continue;
        seen.add(cand.symbol);
        out.push(cand);
        progressed = true;
        break;
      }
      if (out.length >= input.maxCandidates) break;
    }
  }
  return out.slice(0, Math.max(input.maxCandidates, input.watchlist.length));
}

export async function buildUniverse(opts: {
  watchlist: Array<{ symbol: string; sector: string }>;
  maxCandidates: number;
  minPrice: number;
  includeScreener: boolean;
  exclude?: string[];
}): Promise<UniverseEntry[]> {
  if (!opts.includeScreener) {
    return mergeUniverse({ ...opts, gainers: [], losers: [], actives: [] });
  }
  const [movers, actives] = await Promise.all([getTopMovers(20), getMostActives(20, 'volume')]);
  const universe = mergeUniverse({ ...opts, gainers: movers.gainers, losers: movers.losers, actives });
  log.info(`Universe: ${universe.length} candidates (${universe.filter((u) => u.source === 'watchlist').length} watchlist, ${universe.filter((u) => u.source !== 'watchlist').length} screener)`, {
    screener: universe.filter((u) => u.source !== 'watchlist').map((u) => `${u.symbol}:${u.source}`),
  });
  return universe;
}
