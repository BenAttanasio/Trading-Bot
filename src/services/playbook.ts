import fs from 'fs';
import path from 'path';
import { getDb } from './db/connection';
import { getBotState, setBotState } from './db/bot-state';
import { applyTunedParams, resetTunedParams } from '../config/trading-rules';
import { TUNABLE_BOUNDS } from '../config/hard-limits';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('Playbook');

/**
 * The playbook is the bot's self-maintained strategy memory: a markdown file of
 * rules/lessons plus a small set of tuned parameters. Mongo (`bot_state.playbook`)
 * is the source of truth; `playbook/` in the repo only seeds the first version,
 * and PLAYBOOK_MIRROR_DIR (if set) receives a copy of every version for git.
 */
export type PlaybookAuthor = 'seed' | 'nightly_reflection' | 'weekly_review' | 'manual' | 'self_improve';

export interface Playbook {
  version: number;
  strategyMd: string;
  params: Record<string, number>;
  updatedAt: Date;
  updatedBy: PlaybookAuthor;
  rationale: string;
}

export interface PlaybookVersion extends Playbook {
  createdAt: Date;
}

const KEY = 'playbook';
const MAX_STRATEGY_CHARS = 8000;
const VERSIONS = 'playbook_versions';

let current: Playbook | null = null;

function seedDir(): string {
  return process.env.PLAYBOOK_DIR || path.resolve(__dirname, '../../playbook');
}

function readSeed(): { strategyMd: string; params: Record<string, number> } {
  const dir = seedDir();
  let strategyMd = '# Playbook\n\n(empty)\n';
  let params: Record<string, number> = {};
  try {
    strategyMd = fs.readFileSync(path.join(dir, 'strategy.md'), 'utf8');
  } catch {
    log.warn(`No seed strategy.md found in ${dir}; starting with an empty playbook`);
  }
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'params.json'), 'utf8'));
    params = raw?.params && typeof raw.params === 'object' ? raw.params : {};
  } catch {
    /* optional */
  }
  return { strategyMd, params };
}

function mirrorToDisk(pb: Playbook): void {
  const dir = process.env.PLAYBOOK_MIRROR_DIR;
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'strategy.md'), pb.strategyMd);
    fs.writeFileSync(
      path.join(dir, 'params.json'),
      JSON.stringify({ _comment: `playbook v${pb.version} — ${pb.updatedBy}: ${pb.rationale}`, params: pb.params }, null, 2) + '\n'
    );
  } catch (err) {
    log.warn('Failed to mirror playbook to disk', { err });
  }
}

/** Load (or seed) the playbook and apply its tuned params. Call once after the DB connects. */
export async function loadPlaybook(): Promise<Playbook> {
  const saved = await getBotState<Playbook>(KEY);
  if (saved && typeof saved.strategyMd === 'string') {
    current = { ...saved, updatedAt: new Date(saved.updatedAt) };
  } else {
    const seed = readSeed();
    current = {
      version: 1,
      strategyMd: seed.strategyMd,
      params: seed.params,
      updatedAt: new Date(),
      updatedBy: 'seed',
      rationale: 'Initial playbook seeded from repo',
    };
    await setBotState(KEY, current);
    await getDb().collection<PlaybookVersion>(VERSIONS).insertOne({ ...current, createdAt: new Date() });
    log.info('Playbook seeded from repo files');
  }
  resetTunedParams();
  const applied = applyTunedParams(current.params);
  mirrorToDisk(current);
  log.info(`Playbook v${current.version} loaded (${current.strategyMd.length} chars)`, { tunedParams: applied });
  return current;
}

export function getPlaybook(): Playbook | null {
  return current;
}

/** System-prompt block. Stable within a day, so it sits in the cached prefix. */
export function getPlaybookBlock(): string {
  if (!current) return '';
  const tuned = Object.keys(current.params).length
    ? `\n\nTUNED PARAMETERS (already applied to the rules; tunable keys: ${Object.keys(TUNABLE_BOUNDS).join(', ')}):\n${JSON.stringify(current.params)}`
    : '';
  return `PLAYBOOK v${current.version} — the desk's own learned rules and lessons (updated ${current.updatedAt.toISOString().slice(0, 10)} by ${current.updatedBy}). Follow it unless today's evidence clearly contradicts it, and say so when you deviate.\n\n${current.strategyMd}${tuned}`;
}

export interface PlaybookPatch {
  strategyMd?: string;
  params?: Record<string, number>;
  updatedBy: PlaybookAuthor;
  rationale: string;
}

/** Replace the strategy text and/or merge params, bump the version, keep history. */
export async function updatePlaybook(patch: PlaybookPatch): Promise<Playbook> {
  if (!current) await loadPlaybook();
  const prev = current!;

  let strategyMd = prev.strategyMd;
  if (typeof patch.strategyMd === 'string' && patch.strategyMd.trim().length > 0) {
    if (patch.strategyMd.length > MAX_STRATEGY_CHARS) {
      log.warn(`Rejected strategy.md update: ${patch.strategyMd.length} chars exceeds ${MAX_STRATEGY_CHARS}`);
    } else {
      strategyMd = patch.strategyMd;
    }
  }

  const params = { ...prev.params };
  if (patch.params) {
    const applied = applyTunedParams(patch.params);
    Object.assign(params, applied);
  }

  const next: Playbook = {
    version: prev.version + 1,
    strategyMd,
    params,
    updatedAt: new Date(),
    updatedBy: patch.updatedBy,
    rationale: patch.rationale,
  };

  await setBotState(KEY, next);
  await getDb().collection<PlaybookVersion>(VERSIONS).insertOne({ ...next, createdAt: new Date() });
  current = next;
  mirrorToDisk(next);
  log.info(`Playbook updated to v${next.version} by ${next.updatedBy}`, { rationale: next.rationale, params: next.params });
  return next;
}

/** Append a bullet under "## Recent lessons" (FIFO-capped) without an LLM rewrite. */
export async function appendLessons(lessons: string[], updatedBy: PlaybookAuthor, rationale: string, cap = 12): Promise<Playbook | null> {
  if (!current || lessons.length === 0) return current;
  const heading = '## Recent lessons';
  const md = current.strategyMd;
  const idx = md.indexOf(heading);
  const dated = lessons.map((l) => `- [${new Date().toISOString().slice(0, 10)}] ${l.replace(/\s+/g, ' ').trim()}`);

  let next: string;
  if (idx === -1) {
    next = `${md.trimEnd()}\n\n${heading} (auto-appended nightly, consolidated weekly)\n\n${dated.join('\n')}\n`;
  } else {
    const before = md.slice(0, idx);
    const sectionAndRest = md.slice(idx);
    const lines = sectionAndRest.split('\n');
    const headingLine = lines[0];
    const rest = lines.slice(1).join('\n');
    const existing = rest
      .split('\n')
      .filter((l) => l.startsWith('- ') && !l.includes('(none yet)'));
    const merged = [...existing, ...dated].slice(-cap);
    next = `${before}${headingLine}\n\n${merged.join('\n')}\n`;
  }
  return updatePlaybook({ strategyMd: next, updatedBy, rationale });
}

export async function getPlaybookVersions(limit = 20): Promise<PlaybookVersion[]> {
  return getDb().collection<PlaybookVersion>(VERSIONS).find().sort({ version: -1 }).limit(limit).toArray();
}
