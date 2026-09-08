import { ObjectId } from 'mongodb';
import { Prediction, PredictionContext, PredictionOutcome } from '../services/db/models/prediction';
import { insertPrediction, getDuePredictions, markPredictionScored } from '../services/db/learning-queries';
import { getBars, getSnapshot, Bar } from '../services/alpaca/market-data';
import { GatheredMarketData } from '../services/alpaca/gather-data';
import { NewTradeDecisionResult, MorningResearchResult } from '../services/ai/schemas';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('Predictions');

/** Trading days → calendar days (weekends only; holidays are noise at this horizon). */
export function dueDateFor(createdAt: Date, horizonDays: number): Date {
  const calendarDays = Math.ceil(Math.max(1, horizonDays) * (7 / 5));
  return new Date(createdAt.getTime() + calendarDays * 24 * 60 * 60 * 1000);
}

/** Pure scoring: direction hit + Brier, given the price at the due date. */
export function scoreDirection(
  direction: Prediction['direction'],
  confidence: number,
  entryPrice: number,
  priceAtDue: number,
  flatBandPct = 1.5
): { realizedMovePct: number; directionHit: boolean; brier: number } {
  const realizedMovePct = entryPrice > 0 ? ((priceAtDue - entryPrice) / entryPrice) * 100 : 0;
  let directionHit: boolean;
  if (direction === 'up') directionHit = realizedMovePct > 0;
  else if (direction === 'down') directionHit = realizedMovePct < 0;
  else directionHit = Math.abs(realizedMovePct) <= flatBandPct;
  const c = Math.min(1, Math.max(0, confidence));
  const brier = Math.pow(c - (directionHit ? 1 : 0), 2);
  return { realizedMovePct, directionHit, brier };
}

/** Max favorable / adverse excursion from entry over the held bars. */
export function excursions(entryPrice: number, bars: Bar[]): { maxFavorablePct: number | null; maxAdversePct: number | null } {
  if (!bars.length || entryPrice <= 0) return { maxFavorablePct: null, maxAdversePct: null };
  let hi = -Infinity;
  let lo = Infinity;
  for (const b of bars) {
    hi = Math.max(hi, b.h);
    lo = Math.min(lo, b.l);
  }
  return {
    maxFavorablePct: ((hi - entryPrice) / entryPrice) * 100,
    maxAdversePct: ((lo - entryPrice) / entryPrice) * 100,
  };
}

export interface CalibrationBucket {
  range: string;
  n: number;
  hitRate: number | null;
  meanConfidence: number | null;
}

export interface CalibrationReport {
  n: number;
  hitRate: number | null;
  meanBrier: number | null;
  buckets: CalibrationBucket[];
  byTrigger: Record<string, { n: number; hitRate: number }>;
  acted: { n: number; hitRate: number | null; avgMovePct: number | null };
  passed: { n: number; hitRate: number | null; avgMovePct: number | null; missedWinners: number };
}

/** Pure: calibration stats from scored predictions. */
export function computeCalibration(preds: Prediction[]): CalibrationReport {
  const scored = preds.filter((p) => p.outcome);
  const edges = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const inB = scored.filter((p) => p.confidence >= edges[i] && p.confidence < edges[i + 1]);
    const hits = inB.filter((p) => p.outcome!.directionHit).length;
    buckets.push({
      range: `${edges[i].toFixed(1)}-${Math.min(1, edges[i + 1]).toFixed(1)}`,
      n: inB.length,
      hitRate: inB.length ? hits / inB.length : null,
      meanConfidence: inB.length ? inB.reduce((s, p) => s + p.confidence, 0) / inB.length : null,
    });
  }
  const byTrigger: Record<string, { n: number; hitRate: number }> = {};
  for (const p of scored) {
    const t = byTrigger[p.trigger] ?? { n: 0, hitRate: 0 };
    t.n += 1;
    t.hitRate += p.outcome!.directionHit ? 1 : 0;
    byTrigger[p.trigger] = t;
  }
  for (const t of Object.values(byTrigger)) t.hitRate = t.n ? t.hitRate / t.n : 0;

  const group = (list: Prediction[]) => ({
    n: list.length,
    hitRate: list.length ? list.filter((p) => p.outcome!.directionHit).length / list.length : null,
    avgMovePct: list.length ? list.reduce((s, p) => s + p.outcome!.realizedMovePct, 0) / list.length : null,
  });
  const actedList = scored.filter((p) => p.acted);
  const passedList = scored.filter((p) => !p.acted);

  return {
    n: scored.length,
    hitRate: scored.length ? scored.filter((p) => p.outcome!.directionHit).length / scored.length : null,
    meanBrier: scored.length ? scored.reduce((s, p) => s + p.outcome!.brier, 0) / scored.length : null,
    buckets,
    byTrigger,
    acted: group(actedList),
    passed: { ...group(passedList), missedWinners: passedList.filter((p) => p.outcome!.realizedMovePct >= 3).length },
  };
}

/** Record a prediction for a BUY or PASS decision. Never throws (logging only). */
export async function recordPrediction(params: {
  symbol: string;
  decision: NewTradeDecisionResult;
  research: MorningResearchResult;
  data: GatheredMarketData;
  trigger: string;
  acted: boolean;
  orderId: string | null;
  modelUsed: string;
}): Promise<ObjectId | null> {
  const { symbol, decision, research, data, trigger, acted, orderId, modelUsed } = params;
  try {
    const createdAt = new Date();
    const context: PredictionContext = {
      news: data.news.slice(0, 10).map((n) => ({ headline: n.headline, date: n.created_at.split('T')[0], source: n.source })),
      indicators: {
        rsi: data.rsi,
        sma20: data.sma20,
        volumeVsAvg: data.volumeVsAvg,
        priceChange5d: data.priceChange5d,
        priceChange1m: data.priceChange1m,
      },
      available: data.available,
      missing: data.missing,
      researchSummary: research.summary,
      catalystsCited: research.catalysts,
      risksCited: research.risks,
    };
    const prediction: Prediction = {
      symbol,
      createdAt,
      dueAt: dueDateFor(createdAt, decision.prediction.horizonDays),
      status: 'open',
      acted,
      action: decision.action,
      trigger,
      orderId,
      entryPrice: data.currentPrice,
      direction: decision.prediction.direction,
      expectedMovePct: decision.prediction.expectedMovePct,
      horizonDays: decision.prediction.horizonDays,
      confidence: decision.prediction.confidence,
      conviction: decision.conviction,
      catalysts: decision.prediction.catalysts,
      invalidation: decision.prediction.invalidation,
      thesis: decision.thesis,
      modelUsed,
      context,
    };
    const id = await insertPrediction(prediction);
    log.info(`Prediction recorded for ${symbol}: ${decision.prediction.direction} ${decision.prediction.expectedMovePct}% over ${decision.prediction.horizonDays}d (conf ${decision.prediction.confidence})`, {
      acted,
      dueAt: prediction.dueAt.toISOString(),
    });
    return id;
  } catch (error) {
    log.error(`Failed to record prediction for ${symbol}`, { error });
    return null;
  }
}

/** Score every open prediction whose horizon has elapsed. Returns the scored docs. */
export async function scoreDuePredictions(now = new Date()): Promise<Prediction[]> {
  const due = await getDuePredictions(now);
  const scored: Prediction[] = [];
  for (const p of due) {
    try {
      const daysHeld = Math.ceil((now.getTime() - p.createdAt.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      const [snapshot, barsResult] = await Promise.all([
        getSnapshot(p.symbol).catch(() => null),
        getBars(p.symbol, '1Day', Math.min(60, daysHeld + 2)).catch(() => ({ bars: [] as Bar[] })),
      ]);
      const bars = (barsResult.bars ?? []).filter((b) => new Date(b.t) >= p.createdAt);
      const priceAtDue = snapshot?.latestTrade?.p || bars[bars.length - 1]?.c || 0;
      if (!priceAtDue) {
        log.warn(`Cannot score prediction for ${p.symbol}: no price`);
        continue;
      }
      const { realizedMovePct, directionHit, brier } = scoreDirection(p.direction, p.confidence, p.entryPrice, priceAtDue);
      const outcome: PredictionOutcome = {
        scoredAt: now,
        priceAtDue,
        realizedMovePct,
        directionHit,
        brier,
        ...excursions(p.entryPrice, bars),
      };
      await markPredictionScored(p._id!, outcome);
      scored.push({ ...p, status: 'scored', outcome });
      log.info(`Scored ${p.symbol}: predicted ${p.direction} ${p.expectedMovePct.toFixed(1)}%, realized ${realizedMovePct.toFixed(2)}% → ${directionHit ? 'HIT' : 'MISS'} (brier ${brier.toFixed(3)})`);
    } catch (error) {
      log.error(`Failed to score prediction for ${p.symbol}`, { error });
    }
  }
  return scored;
}
