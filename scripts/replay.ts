/**
 * Offline replay: run the SAME ranking prompt the morning cycle uses over past
 * trading days, with only the data that existed before each open, then score
 * every side call at its horizon. Prints calibration, hit rates, a top-k long
 * basket vs SPY, and the always-up baseline, and writes a JSON report.
 *
 *   npx tsx scripts/replay.ts --from 2026-06-01 --to 2026-08-29
 *   npx tsx scripts/replay.ts --from 2026-07-01 --to 2026-08-29 --model fast --top 5 --shorts
 *   npx tsx scripts/replay.ts --from 2026-07-01 --to 2026-08-29 --dry        # baseline only, no AI
 *
 * Flags: --symbols AAPL,MSFT (default: seed watchlist) --model budget|fast|deep (default budget)
 *        --top N (default 5) --shorts --no-news --every N (use every Nth trading day) --out path
 */
import { config } from 'dotenv';
import path from 'path';
import fs from 'fs';
config({ path: path.resolve(__dirname, '../.env') });

import { DEFAULT_WATCHLIST } from '../src/config/watchlist';
import { getMarketCalendar, getBarsMulti, Bar } from '../src/services/alpaca/market-data';
import { buildMarketContext, INDEX_ETFS, SECTOR_ETFS } from '../src/services/alpaca/market-context';
import { UniverseEntry } from '../src/services/alpaca/screener';
import { rankUniverse } from '../src/engine/scout';
import { scoreDirection, computeCalibration } from '../src/engine/predictions';
import { getDetailedTokenUsage, ModelTier } from '../src/services/ai/client';
import { connectDB, disconnectDB } from '../src/services/db/connection';
import { loadPlaybook } from '../src/services/playbook';
import type { Prediction } from '../src/services/db/models/prediction';

interface Args {
  from: string;
  to: string;
  symbols: string[];
  model: ModelTier;
  top: number;
  shorts: boolean;
  news: boolean;
  every: number;
  dry: boolean;
  out: string | null;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string) => argv.includes(`--${k}`);
  const to = get('to') ?? new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const from = get('from') ?? new Date(new Date(to).getTime() - 60 * 86400000).toISOString().slice(0, 10);
  const symbols = (get('symbols') ?? DEFAULT_WATCHLIST.map((w) => w.symbol).join(',')).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const model = (get('model') ?? 'budget') as ModelTier;
  if (!['budget', 'fast', 'deep'].includes(model)) throw new Error(`bad --model ${model}`);
  return {
    from,
    to,
    symbols,
    model,
    top: parseInt(get('top') ?? '5', 10),
    shorts: has('shorts'),
    news: !has('no-news'),
    every: Math.max(1, parseInt(get('every') ?? '1', 10)),
    dry: has('dry'),
    out: get('out') ?? null,
  };
}

interface ReplayPrediction {
  date: string;
  symbol: string;
  side: 'long' | 'short';
  score: number;
  conviction: number;
  confidence: number;
  horizonDays: number;
  expectedMovePct: number;
  entryPrice: number;
  priceAtDue: number | null;
  realizedMovePct: number | null;
  directionHit: boolean | null;
  brier: number | null;
  spyMovePct: number | null;
}

const dateOf = (b: Bar) => b.t.slice(0, 10);

/** Bars strictly before `date` (no look-ahead), last `n`. */
function barsBefore(bars: Bar[], date: string, n = 30): Bar[] {
  const idx = bars.findIndex((b) => dateOf(b) >= date);
  const upto = idx === -1 ? bars : bars.slice(0, idx);
  return upto.slice(-n);
}

/** Close `h` trading days after the first bar on/after `date` (the entry day), or null. */
function closeAfter(bars: Bar[], date: string, h: number): number | null {
  const idx = bars.findIndex((b) => dateOf(b) >= date);
  if (idx === -1) return null;
  const due = bars[idx + Math.max(1, h) - 1];
  return due ? due.c : null;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Replay ${args.from} → ${args.to} | ${args.symbols.length} symbols | model ${args.model} | top ${args.top}${args.shorts ? ' +shorts' : ''}${args.dry ? ' | DRY (no AI)' : ''}`);

  let dbOk = false;
  try {
    await connectDB();
    await loadPlaybook();
    dbOk = true;
  } catch (err) {
    console.warn('No DB — running without the playbook block and without usage persistence');
  }

  const calendar = await getMarketCalendar(args.from, args.to);
  const days = calendar.map((d) => d.date).filter((_, i) => i % args.every === 0);
  if (days.length === 0) throw new Error('No trading days in range');

  const etfs = [...INDEX_ETFS, ...Array.from(new Set(Object.values(SECTOR_ETFS)))];
  const all = Array.from(new Set([...args.symbols, ...etfs]));
  const start = new Date(new Date(args.from).getTime() - 90 * 86400000).toISOString().slice(0, 10);
  const end = new Date(Math.min(Date.now() - 20 * 60 * 1000, new Date(args.to).getTime() + 60 * 86400000)).toISOString();
  console.log(`Fetching daily bars ${start} → ${end.slice(0, 10)} for ${all.length} symbols...`);
  const allBars = await getBarsMulti(all, '1Day', 400, end, start);
  const spyBars = allBars.SPY ?? [];

  const sectorOf = new Map(DEFAULT_WATCHLIST.map((w) => [w.symbol, w.sector]));
  const universe: UniverseEntry[] = args.symbols.map((s) => ({ symbol: s, sector: sectorOf.get(s) ?? '', source: 'watchlist', note: 'replay' }));

  const preds: ReplayPrediction[] = [];
  const baskets: Array<{ date: string; basketPct: number; spyPct: number; n: number }> = [];
  const baselineUp: boolean[] = [];
  let calls = 0;

  for (const day of days) {
    const barsBySymbol: Record<string, Bar[]> = {};
    for (const s of all) barsBySymbol[s] = barsBefore(allBars[s] ?? [], day, 60);
    const ctx = buildMarketContext(barsBySymbol, new Date(day));

    // Baseline: 5-day always-up hit rate for every candidate with data
    for (const s of args.symbols) {
      const b = barsBySymbol[s];
      if (!b?.length) continue;
      const due = closeAfter(allBars[s] ?? [], day, 5);
      if (due != null) baselineUp.push(due > b[b.length - 1].c);
    }
    if (args.dry) continue;

    const asOf = `${day}T14:00:00Z`;
    let out;
    try {
      out = await rankUniverse({
        universe,
        asOf,
        barsBySymbol: Object.fromEntries(args.symbols.map((s) => [s, barsBySymbol[s]?.slice(-30) ?? []])),
        marketContext: ctx,
        model: args.model,
        maxLongs: args.top,
        maxShorts: args.shorts ? Math.max(1, Math.floor(args.top / 2)) : 0,
        persist: false,
      });
      calls += 1;
    } catch (err: any) {
      console.warn(`${day}: ranking failed — ${err.message}`);
      continue;
    }
    if (!out) continue;
    if (!args.news) {
      /* news was skipped inside gather via newsLimit; nothing else to do */
    }

    const spyEntry = barsBySymbol.SPY?.[barsBySymbol.SPY.length - 1]?.c ?? null;
    const dayPreds: ReplayPrediction[] = [];
    for (const c of out.ranking.candidates) {
      if (c.side === 'none') continue;
      const entry = out.data.get(c.symbol)?.currentPrice ?? 0;
      if (!(entry > 0)) continue;
      const due = closeAfter(allBars[c.symbol] ?? [], day, c.horizonDays);
      const spyDue = spyEntry ? closeAfter(spyBars, day, c.horizonDays) : null;
      let realized: number | null = null;
      let hit: boolean | null = null;
      let brier: number | null = null;
      if (due != null) {
        const s = scoreDirection(c.side === 'long' ? 'up' : 'down', c.confidence, entry, due);
        realized = s.realizedMovePct;
        hit = s.directionHit;
        brier = s.brier;
      }
      dayPreds.push({
        date: day,
        symbol: c.symbol,
        side: c.side,
        score: c.score,
        conviction: c.conviction,
        confidence: c.confidence,
        horizonDays: c.horizonDays,
        expectedMovePct: c.expectedMovePct,
        entryPrice: entry,
        priceAtDue: due,
        realizedMovePct: realized,
        directionHit: hit,
        brier,
        spyMovePct: spyDue != null && spyEntry ? ((spyDue - spyEntry) / spyEntry) * 100 : null,
      });
    }
    preds.push(...dayPreds);

    // Top-k long basket vs SPY over 5 days
    const longs = dayPreds.filter((p) => p.side === 'long').sort((a, b) => b.score - a.score).slice(0, args.top);
    const basketMoves = longs
      .map((p) => {
        const due = closeAfter(allBars[p.symbol] ?? [], day, 5);
        return due != null ? ((due - p.entryPrice) / p.entryPrice) * 100 : null;
      })
      .filter((v): v is number => v != null);
    const spy5 = spyEntry ? closeAfter(spyBars, day, 5) : null;
    if (basketMoves.length && spy5 != null && spyEntry) {
      baskets.push({ date: day, basketPct: mean(basketMoves)!, spyPct: ((spy5 - spyEntry) / spyEntry) * 100, n: basketMoves.length });
    }

    const scoredToday = dayPreds.filter((p) => p.directionHit != null);
    console.log(`${day}: ${out.ranking.regime.padEnd(8)} ${dayPreds.length} calls (${scoredToday.filter((p) => p.directionHit).length}/${scoredToday.length} hit) · longs ${longs.map((p) => p.symbol).join(',') || '-'}`);
  }

  // ─── Summary ────────────────────────────────────────
  const scored = preds.filter((p) => p.directionHit != null);
  const asPrediction = (p: ReplayPrediction): Prediction => ({
    symbol: p.symbol,
    createdAt: new Date(p.date),
    dueAt: new Date(p.date),
    status: 'scored',
    acted: true,
    action: 'BUY',
    trigger: p.side,
    orderId: null,
    entryPrice: p.entryPrice,
    direction: p.side === 'long' ? 'up' : 'down',
    expectedMovePct: p.expectedMovePct,
    horizonDays: p.horizonDays,
    confidence: p.confidence,
    conviction: p.conviction,
    catalysts: [],
    invalidation: '',
    thesis: '',
    modelUsed: args.model,
    context: { news: [], indicators: { rsi: null, sma20: null, volumeVsAvg: null, priceChange5d: null, priceChange1m: null }, available: [], missing: [] },
    outcome: { scoredAt: new Date(), priceAtDue: p.priceAtDue!, realizedMovePct: p.realizedMovePct!, directionHit: p.directionHit!, brier: p.brier!, maxFavorablePct: null, maxAdversePct: null },
  });
  const cal = computeCalibration(scored.map(asPrediction));
  const strong = scored.filter((p) => Math.abs(p.score) >= 6);
  const weak = scored.filter((p) => Math.abs(p.score) < 6);
  const hitRate = (xs: ReplayPrediction[]) => (xs.length ? xs.filter((p) => p.directionHit).length / xs.length : null);
  const alpha = scored.filter((p) => p.spyMovePct != null).map((p) => (p.side === 'long' ? 1 : -1) * (p.realizedMovePct! - p.spyMovePct!));
  const basketAvg = mean(baskets.map((b) => b.basketPct));
  const basketSpy = mean(baskets.map((b) => b.spyPct));
  const usage = getDetailedTokenUsage();

  const summary = {
    args,
    tradingDays: days.length,
    rankingCalls: calls,
    predictions: preds.length,
    scored: scored.length,
    hitRate: cal.hitRate,
    meanBrier: cal.meanBrier,
    baselineAlwaysUp5d: baselineUp.length ? baselineUp.filter(Boolean).length / baselineUp.length : null,
    byStrength: { strong: { n: strong.length, hitRate: hitRate(strong) }, weak: { n: weak.length, hitRate: hitRate(weak) } },
    bySide: { long: { n: cal.byTrigger.long?.n ?? 0, hitRate: cal.byTrigger.long?.hitRate ?? null }, short: { n: cal.byTrigger.short?.n ?? 0, hitRate: cal.byTrigger.short?.hitRate ?? null } },
    avgRealizedPct: mean(scored.map((p) => (p.side === 'long' ? 1 : -1) * p.realizedMovePct!)),
    avgAlphaVsSpyPct: mean(alpha),
    buckets: cal.buckets,
    topKBasket5d: { days: baskets.length, avgBasketPct: basketAvg, avgSpyPct: basketSpy, avgAlphaPct: basketAvg != null && basketSpy != null ? basketAvg - basketSpy : null },
    aiCostUsd: usage.costUsd,
  };

  console.log('\n═══ REPLAY SUMMARY ═══');
  console.log(`Days ${days.length} · ranking calls ${calls} · side calls ${preds.length} · scored ${scored.length}`);
  console.log(`Direction hit rate: ${cal.hitRate == null ? 'n/a' : (cal.hitRate * 100).toFixed(1) + '%'}  (always-up 5d baseline ${summary.baselineAlwaysUp5d == null ? 'n/a' : (summary.baselineAlwaysUp5d * 100).toFixed(1) + '%'}) · Brier ${cal.meanBrier?.toFixed(3) ?? 'n/a'}`);
  console.log(`|score|>=6: n=${strong.length} hit ${hitRate(strong) == null ? 'n/a' : (hitRate(strong)! * 100).toFixed(1) + '%'} · |score|<6: n=${weak.length} hit ${hitRate(weak) == null ? 'n/a' : (hitRate(weak)! * 100).toFixed(1) + '%'}`);
  console.log(`Avg realized (side-adjusted) ${summary.avgRealizedPct?.toFixed(2) ?? 'n/a'}% · avg alpha vs SPY ${summary.avgAlphaVsSpyPct?.toFixed(2) ?? 'n/a'}%`);
  console.log(`Top-${args.top} long basket, 5d: ${basketAvg?.toFixed(2) ?? 'n/a'}% vs SPY ${basketSpy?.toFixed(2) ?? 'n/a'}% over ${baskets.length} days`);
  console.log(`Calibration: ${cal.buckets.filter((b) => b.n).map((b) => `${b.range} n=${b.n} stated ${Math.round((b.meanConfidence ?? 0) * 100)}% actual ${Math.round((b.hitRate ?? 0) * 100)}%`).join(' | ') || 'n/a'}`);
  console.log(`AI spend: $${usage.costUsd.toFixed(3)}`);

  const outPath = args.out ?? path.resolve(__dirname, `../replay-results/replay_${args.from}_${args.to}_${args.model}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ summary, baskets, predictions: preds }, null, 2));
  console.log(`Report → ${outPath}`);

  if (dbOk) await disconnectDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
