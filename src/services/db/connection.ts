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
    // Compound index for risk-manager queries (by symbol + date range + action)
    { key: { symbol: 1, action: 1, createdAt: -1 }, name: 'symbol_action_date' },
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

  // Bot state (kill switch, AI usage, starting equity, playbook)
  await db.collection('bot_state').createIndexes([
    { key: { key: 1 }, unique: true },
  ]);

  // Learning layer
  await db.collection('predictions').createIndexes([
    { key: { status: 1, dueAt: 1 } },
    { key: { symbol: 1, createdAt: -1 } },
    { key: { createdAt: -1 } },
  ]);
  await db.collection('reflections').createIndexes([
    { key: { createdAt: -1 } },
    { key: { type: 1, date: -1 } },
  ]);
  await db.collection('benchmarks').createIndexes([
    { key: { date: 1 }, unique: true },
  ]);
  await db.collection('playbook_versions').createIndexes([
    { key: { version: -1 } },
  ]);
  await db.collection('change_requests').createIndexes([
    { key: { status: 1, createdAt: -1 } },
  ]);

  // TTL indexes — auto-delete old documents to keep storage bounded
  // decision_log: keep 90 days (high-volume collection)
  await db.collection('decision_log').createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60, name: 'ttl_90d' }
  );
  // alerts: keep 30 days
  await db.collection('alerts').createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 30 * 24 * 60 * 60, name: 'ttl_30d' }
  );
  // research: keep 90 days
  await db.collection('research').createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60, name: 'ttl_90d' }
  );
  // trades and daily_summaries are kept forever (financial records)

  log.info('Database indexes created');
}
