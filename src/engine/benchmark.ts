import { getSnapshot, getBars } from '../services/alpaca/market-data';
import { upsertBenchmark, getBenchmarks } from '../services/db/learning-queries';
import { Benchmark } from '../services/db/models/reflection';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('Benchmark');

export const BENCHMARK_SYMBOL = 'SPY';

/** Record today's equity alongside SPY's close so progress is always judged against the index. */
export async function recordDailyBenchmark(date: string, equity: number): Promise<Benchmark> {
  let spyClose: number | null = null;
  try {
    const snap = await getSnapshot(BENCHMARK_SYMBOL);
    spyClose = snap.dailyBar?.c ?? snap.latestTrade?.p ?? null;
  } catch (err) {
    try {
      const { bars } = await getBars(BENCHMARK_SYMBOL, '1Day', 2);
      spyClose = bars?.[bars.length - 1]?.c ?? null;
    } catch {
      log.warn('Could not fetch SPY close for benchmark', { err });
    }
  }
  const doc: Benchmark = { date, equity, spyClose, createdAt: new Date() };
  await upsertBenchmark(doc);
  log.info(`Benchmark recorded for ${date}`, { equity: equity.toFixed(2), spyClose });
  return doc;
}

export interface BenchmarkComparison {
  from: string | null;
  to: string | null;
  botReturnPct: number | null;
  spyReturnPct: number | null;
  alphaPct: number | null;
  series: Array<{ date: string; equity: number; spyClose: number | null; botIdx: number; spyIdx: number | null }>;
}

/** Pure: index both series to 100 at the first point and compute period returns. */
export function compareToBenchmark(rows: Benchmark[]): BenchmarkComparison {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return { from: null, to: null, botReturnPct: null, spyReturnPct: null, alphaPct: null, series: [] };
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const firstSpy = sorted.find((r) => r.spyClose != null)?.spyClose ?? null;
  const lastSpy = [...sorted].reverse().find((r) => r.spyClose != null)?.spyClose ?? null;
  const botReturnPct = first.equity > 0 ? ((last.equity - first.equity) / first.equity) * 100 : null;
  const spyReturnPct = firstSpy && lastSpy ? ((lastSpy - firstSpy) / firstSpy) * 100 : null;
  return {
    from: first.date,
    to: last.date,
    botReturnPct,
    spyReturnPct,
    alphaPct: botReturnPct != null && spyReturnPct != null ? botReturnPct - spyReturnPct : null,
    series: sorted.map((r) => ({
      date: r.date,
      equity: r.equity,
      spyClose: r.spyClose,
      botIdx: first.equity > 0 ? (r.equity / first.equity) * 100 : 100,
      spyIdx: firstSpy && r.spyClose != null ? (r.spyClose / firstSpy) * 100 : null,
    })),
  };
}

export async function getBenchmarkComparison(days = 90): Promise<BenchmarkComparison> {
  return compareToBenchmark(await getBenchmarks(days));
}
