import { ObjectId } from 'mongodb';
import { getDb } from './connection';
import { Trade, OrderStatus } from './models/trade';
import { Position } from './models/position';
import { DecisionLog } from './models/decision-log';
import { Alert } from './models/alert';
import { DailySummary } from './models/daily-summary';
import { WatchlistItem } from './models/watchlist';
import { Research } from './models/research';
import { getETDateString } from '../../utils/time';

// ─── Trades ──────────────────────────────────────────────

export async function insertTrade(trade: Trade): Promise<ObjectId> {
  const result = await getDb().collection<Trade>('trades').insertOne(trade);
  return result.insertedId;
}

export async function updateTradeStatus(orderId: string, status: OrderStatus, filledAt?: Date): Promise<void> {
  await getDb().collection<Trade>('trades').updateOne(
    { orderId },
    { $set: { orderStatus: status, ...(filledAt ? { filledAt } : {}) } }
  );
}

export async function getRecentTrades(limit: number = 50): Promise<Trade[]> {
  return getDb().collection<Trade>('trades')
    .find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

export async function getTradesToday(): Promise<Trade[]> {
  const todayStr = getETDateString();
  const startOfDay = new Date(todayStr);
  return getDb().collection<Trade>('trades')
    .find({ createdAt: { $gte: startOfDay } })
    .toArray();
}

export async function getTradesForSymbol(symbol: string, days: number = 7): Promise<Trade[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return getDb().collection<Trade>('trades')
    .find({ symbol, createdAt: { $gte: since } })
    .sort({ createdAt: -1 })
    .toArray();
}

// ─── Positions ───────────────────────────────────────────

export async function upsertPosition(position: Position): Promise<void> {
  await getDb().collection<Position>('positions').updateOne(
    { symbol: position.symbol },
    { $set: position },
    { upsert: true }
  );
}

export async function getPosition(symbol: string): Promise<Position | null> {
  return getDb().collection<Position>('positions').findOne({ symbol });
}

export async function getAllPositions(): Promise<Position[]> {
  return getDb().collection<Position>('positions').find().toArray();
}

export async function removePosition(symbol: string): Promise<void> {
  await getDb().collection<Position>('positions').deleteOne({ symbol });
}

// ─── Decision Log ────────────────────────────────────────

export async function insertDecisionLog(log: DecisionLog): Promise<ObjectId> {
  const result = await getDb().collection<DecisionLog>('decision_log').insertOne(log);
  return result.insertedId;
}

export async function getRecentDecisions(symbol: string, limit: number = 10): Promise<DecisionLog[]> {
  return getDb().collection<DecisionLog>('decision_log')
    .find({ symbol })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

export async function getDecisionsToday(): Promise<DecisionLog[]> {
  const todayStr = getETDateString();
  const startOfDay = new Date(todayStr);
  return getDb().collection<DecisionLog>('decision_log')
    .find({ createdAt: { $gte: startOfDay } })
    .toArray();
}

// ─── Alerts ──────────────────────────────────────────────

export async function insertAlert(alert: Alert): Promise<ObjectId> {
  const result = await getDb().collection<Alert>('alerts').insertOne(alert);
  return result.insertedId;
}

export async function getRecentAlerts(limit: number = 50): Promise<Alert[]> {
  return getDb().collection<Alert>('alerts')
    .find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

// ─── Daily Summaries ─────────────────────────────────────

export async function upsertDailySummary(summary: DailySummary): Promise<void> {
  await getDb().collection<DailySummary>('daily_summaries').updateOne(
    { date: summary.date },
    { $set: summary },
    { upsert: true }
  );
}

export async function getDailySummaries(days: number = 30): Promise<DailySummary[]> {
  return getDb().collection<DailySummary>('daily_summaries')
    .find()
    .sort({ date: -1 })
    .limit(days)
    .toArray();
}

export async function getTodaySummary(): Promise<DailySummary | null> {
  const todayStr = getETDateString();
  // Convert MM/DD/YYYY to a comparable format
  const [month, day, year] = todayStr.split('/');
  const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return getDb().collection<DailySummary>('daily_summaries').findOne({ date: dateStr });
}

// ─── Watchlist ───────────────────────────────────────────

export async function getActiveWatchlist(): Promise<WatchlistItem[]> {
  return getDb().collection<WatchlistItem>('watchlist')
    .find({ active: true })
    .toArray();
}

export async function addToWatchlist(item: WatchlistItem): Promise<void> {
  await getDb().collection<WatchlistItem>('watchlist').updateOne(
    { symbol: item.symbol },
    { $set: item },
    { upsert: true }
  );
}

export async function removeFromWatchlist(symbol: string): Promise<void> {
  await getDb().collection<WatchlistItem>('watchlist').updateOne(
    { symbol },
    { $set: { active: false } }
  );
}

// ─── Research ────────────────────────────────────────────

export async function insertResearch(research: Research): Promise<ObjectId> {
  const result = await getDb().collection<Research>('research').insertOne(research);
  return result.insertedId;
}

export async function getRecentResearch(limit: number = 20): Promise<Research[]> {
  return getDb().collection<Research>('research')
    .find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

export async function getResearchForSymbol(symbol: string): Promise<Research[]> {
  return getDb().collection<Research>('research')
    .find({ symbol })
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();
}
