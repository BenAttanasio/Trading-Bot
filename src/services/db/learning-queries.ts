import { ObjectId } from 'mongodb';
import { getDb } from './connection';
import { Prediction, PredictionOutcome } from './models/prediction';
import { Reflection, Benchmark, ChangeRequest, ChangeRequestStatus } from './models/reflection';

// ─── Predictions ─────────────────────────────────────────

export async function insertPrediction(p: Prediction): Promise<ObjectId> {
  const r = await getDb().collection<Prediction>('predictions').insertOne(p);
  return r.insertedId;
}

export async function getDuePredictions(now = new Date()): Promise<Prediction[]> {
  return getDb().collection<Prediction>('predictions')
    .find({ status: 'open', dueAt: { $lte: now } })
    .sort({ dueAt: 1 })
    .limit(50)
    .toArray();
}

export async function markPredictionScored(id: ObjectId, outcome: PredictionOutcome): Promise<void> {
  await getDb().collection<Prediction>('predictions').updateOne(
    { _id: id },
    { $set: { status: 'scored', outcome } }
  );
}

export async function attachVerdict(id: ObjectId, verdict: PredictionOutcome['verdict'], lesson: string, reflectionId: ObjectId): Promise<void> {
  await getDb().collection<Prediction>('predictions').updateOne(
    { _id: id },
    { $set: { 'outcome.verdict': verdict, 'outcome.lesson': lesson, 'outcome.reflectionId': reflectionId } }
  );
}

export async function getScoredPredictions(days = 90, limit = 500): Promise<Prediction[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return getDb().collection<Prediction>('predictions')
    .find({ status: 'scored', createdAt: { $gte: since } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

export async function getPredictionsScoredSince(since: Date): Promise<Prediction[]> {
  return getDb().collection<Prediction>('predictions')
    .find({ status: 'scored', 'outcome.scoredAt': { $gte: since } })
    .sort({ 'outcome.scoredAt': -1 })
    .toArray();
}

export async function getOpenPredictionForSymbol(symbol: string): Promise<Prediction | null> {
  return getDb().collection<Prediction>('predictions')
    .findOne({ symbol, status: 'open', acted: true }, { sort: { createdAt: -1 } });
}

export async function getRecentPredictions(limit = 50): Promise<Prediction[]> {
  return getDb().collection<Prediction>('predictions').find().sort({ createdAt: -1 }).limit(limit).toArray();
}

// ─── Rankings (one snapshot per morning cycle) ──────────

export interface RankingSnapshot {
  _id?: ObjectId;
  date: string;
  marketRead: string;
  regime: 'risk_on' | 'risk_off' | 'mixed';
  universeSize: number;
  candidates: Array<{
    symbol: string;
    side: 'long' | 'short' | 'none';
    score: number;
    conviction: number;
    confidence: number;
    horizonDays: number;
    expectedMovePct: number;
    summary: string;
    catalysts: string[];
    risks: string[];
    invalidationPrice: number | null;
    targetPrice: number | null;
  }>;
  modelUsed: string;
  createdAt: Date;
}

export async function insertRanking(r: RankingSnapshot): Promise<ObjectId> {
  const res = await getDb().collection<RankingSnapshot>('rankings').insertOne(r);
  return res.insertedId;
}

export async function getLatestRanking(): Promise<RankingSnapshot | null> {
  return getDb().collection<RankingSnapshot>('rankings').findOne({}, { sort: { createdAt: -1 } });
}

// ─── Reflections ─────────────────────────────────────────

export async function insertReflection(r: Reflection): Promise<ObjectId> {
  const res = await getDb().collection<Reflection>('reflections').insertOne(r);
  return res.insertedId;
}

export async function getRecentReflections(limit = 14, type?: Reflection['type']): Promise<Reflection[]> {
  return getDb().collection<Reflection>('reflections')
    .find(type ? { type } : {})
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

export async function getReflectionsSince(since: Date): Promise<Reflection[]> {
  return getDb().collection<Reflection>('reflections')
    .find({ createdAt: { $gte: since } })
    .sort({ createdAt: 1 })
    .toArray();
}

// ─── Benchmarks ──────────────────────────────────────────

export async function upsertBenchmark(b: Benchmark): Promise<void> {
  const { _id, ...doc } = b;
  await getDb().collection<Benchmark>('benchmarks').updateOne({ date: b.date }, { $set: doc }, { upsert: true });
}

export async function getBenchmarks(days = 90): Promise<Benchmark[]> {
  return getDb().collection<Benchmark>('benchmarks').find().sort({ date: -1 }).limit(days).toArray();
}

// ─── Change requests ─────────────────────────────────────

export async function insertChangeRequest(cr: ChangeRequest): Promise<ObjectId> {
  const res = await getDb().collection<ChangeRequest>('change_requests').insertOne(cr);
  return res.insertedId;
}

export async function getChangeRequests(status?: ChangeRequestStatus, limit = 50): Promise<ChangeRequest[]> {
  return getDb().collection<ChangeRequest>('change_requests')
    .find(status ? { status } : {})
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

export async function updateChangeRequest(id: ObjectId, patch: Partial<ChangeRequest>, note?: string): Promise<void> {
  const update: Record<string, unknown> = { $set: { ...patch, updatedAt: new Date() } };
  if (note) update.$push = { notes: `[${new Date().toISOString()}] ${note}` };
  await getDb().collection<ChangeRequest>('change_requests').updateOne({ _id: id }, update);
}

export async function getChangeRequestById(id: ObjectId): Promise<ChangeRequest | null> {
  return getDb().collection<ChangeRequest>('change_requests').findOne({ _id: id });
}
