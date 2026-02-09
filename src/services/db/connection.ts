import { MongoClient, Db } from 'mongodb';
import { env } from '../../config/env';
import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('MongoDB');

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDB(): Promise<Db> {
  if (db) return db;

  try {
    client = new MongoClient(env.MONGODB_URI);
    await client.connect();
    db = client.db(env.MONGODB_DB_NAME);

    // Verify connection
    await db.command({ ping: 1 });
    log.info(`Connected to MongoDB database: ${env.MONGODB_DB_NAME}`);

    // Create indexes
    await createIndexes(db);

    return db;
  } catch (error) {
    log.error('Failed to connect to MongoDB', { error });
    throw error;
  }
}

export function getDb(): Db {
  if (!db) throw new Error('Database not connected. Call connectDB() first.');
  return db;
}

export async function disconnectDB(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    log.info('Disconnected from MongoDB');
  }
}

async function createIndexes(db: Db): Promise<void> {
  // Trades
  await db.collection('trades').createIndexes([
    { key: { symbol: 1, createdAt: -1 } },
    { key: { createdAt: -1 } },
    { key: { trigger: 1 } },
  ]);

  // Positions
  await db.collection('positions').createIndexes([
    { key: { symbol: 1 }, unique: true },
    { key: { thesisFreshness: 1 } },
  ]);

  // Decision log
  await db.collection('decision_log').createIndexes([
    { key: { symbol: 1, createdAt: -1 } },
    { key: { createdAt: -1 } },
    { key: { workflow: 1 } },
  ]);

  // Daily summaries
  await db.collection('daily_summaries').createIndexes([
    { key: { date: 1 }, unique: true },
  ]);

  // Alerts
  await db.collection('alerts').createIndexes([
    { key: { createdAt: -1 } },
    { key: { symbol: 1, createdAt: -1 } },
    { key: { urgency: -1 } },
  ]);

  // Watchlist
  await db.collection('watchlist').createIndexes([
    { key: { symbol: 1 }, unique: true },
    { key: { active: 1 } },
  ]);

  log.info('Database indexes created');
}
