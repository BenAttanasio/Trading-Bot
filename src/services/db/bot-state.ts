import { getDb } from './connection';

/**
 * Small key/value store for runtime state that must survive restarts:
 * kill switch, AI usage counters, starting equity, playbook version, etc.
 */
export interface BotStateDoc<T = unknown> {
  key: string;
  value: T;
  updatedAt: Date;
}

const COLLECTION = 'bot_state';
const STARTING_EQUITY_KEY = 'startingEquity';

export async function getBotState<T>(key: string): Promise<T | null> {
  const doc = await getDb().collection<BotStateDoc<T>>(COLLECTION).findOne({ key });
  return doc ? doc.value : null;
}

export async function setBotState<T>(key: string, value: T): Promise<void> {
  await getDb().collection<BotStateDoc<T>>(COLLECTION).updateOne(
    { key },
    { $set: { value, updatedAt: new Date() } },
    { upsert: true }
  );
}

export async function getAllBotState(): Promise<Record<string, unknown>> {
  const docs = await getDb().collection<BotStateDoc>(COLLECTION).find().toArray();
  return Object.fromEntries(docs.map((d) => [d.key, d.value]));
}

/**
 * Baseline for "total P&L since inception". An explicit override (env) always
 * wins; otherwise the first observed equity is captured once and kept.
 */
export async function ensureStartingEquity(currentEquity: number, override: number | null): Promise<number> {
  if (override !== null && Number.isFinite(override) && override > 0) {
    await setBotState(STARTING_EQUITY_KEY, override);
    return override;
  }
  const existing = await getBotState<number>(STARTING_EQUITY_KEY);
  if (existing !== null && Number.isFinite(existing) && existing > 0) return existing;
  await setBotState(STARTING_EQUITY_KEY, currentEquity);
  return currentEquity;
}

export async function getStartingEquity(): Promise<number | null> {
  return getBotState<number>(STARTING_EQUITY_KEY);
}
