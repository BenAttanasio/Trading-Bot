import { env } from '../../config/env';
import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('EDGAR');

/**
 * SEC EDGAR filings as a catalyst source the market may not have fully read:
 * 8-K item codes (earnings, M&A, officer changes, restatements), 10-Q/10-K,
 * 13D stakes, shelf/offering prospectuses. Uses the documented submissions
 * JSON per company (no key; a descriptive User-Agent is mandatory).
 */

const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SUBMISSIONS_URL = (cik: string) => `https://data.sec.gov/submissions/CIK${cik}.json`;

const FORMS_OF_INTEREST = new Set(['8-K', '8-K/A', '10-Q', '10-K', 'SC 13D', 'SC 13D/A', '424B5', '424B4', 'S-3', 'S-1', 'DEFM14A', 'SC TO-T']);

export const ITEM_LABELS: Record<string, string> = {
  '1.01': 'material agreement',
  '1.02': 'agreement terminated',
  '1.03': 'bankruptcy',
  '2.01': 'acquisition/disposition completed',
  '2.02': 'earnings results',
  '2.03': 'new debt obligation',
  '2.04': 'debt acceleration',
  '2.05': 'exit/restructuring costs',
  '2.06': 'impairment',
  '3.01': 'delisting notice',
  '3.02': 'unregistered equity sale',
  '4.01': 'auditor change',
  '4.02': 'non-reliance on prior financials (restatement)',
  '5.01': 'change in control',
  '5.02': 'officer/director change',
  '5.03': 'bylaw/charter change',
  '5.07': 'shareholder vote',
  '5.08': 'shareholder nominations',
  '7.01': 'Reg FD disclosure',
  '8.01': 'other events',
  '9.01': 'exhibits',
};

export interface Filing {
  form: string;
  date: string;
  items: string[];
  description: string;
}

let tickerMap: { at: number; map: Map<string, string> } | null = null;
const submissionsCache = new Map<string, { at: number; filings: Filing[] }>();
const TICKER_TTL = 24 * 60 * 60 * 1000;
const SUBMISSIONS_TTL = 6 * 60 * 60 * 1000;

export function edgarEnabled(): boolean {
  return env.EDGAR_USER_AGENT.trim().length > 0;
}

async function edgarFetch<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': env.EDGAR_USER_AGENT, 'Accept-Encoding': 'gzip, deflate', Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`EDGAR ${res.status} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function getTickerMap(): Promise<Map<string, string>> {
  if (tickerMap && Date.now() - tickerMap.at < TICKER_TTL) return tickerMap.map;
  const raw = await edgarFetch<Record<string, { cik_str: number; ticker: string; title: string }>>(TICKERS_URL);
  const map = new Map<string, string>();
  for (const row of Object.values(raw)) {
    map.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, '0'));
  }
  tickerMap = { at: Date.now(), map };
  return map;
}

interface Submissions {
  filings: {
    recent: {
      form: string[];
      filingDate: string[];
      items: string[];
      primaryDocDescription: string[];
      reportDate: string[];
    };
  };
}

/** Pure: parse the column-oriented `recent` block into rows we care about. */
export function parseRecentFilings(recent: Submissions['filings']['recent']): Filing[] {
  const out: Filing[] = [];
  const n = recent.form?.length ?? 0;
  for (let i = 0; i < n; i++) {
    const form = recent.form[i];
    if (!FORMS_OF_INTEREST.has(form)) continue;
    const items = (recent.items?.[i] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    out.push({
      form,
      date: recent.filingDate[i],
      items,
      description: recent.primaryDocDescription?.[i] ?? '',
    });
  }
  return out;
}

/** Filings for `symbol` in the `days` before `asOf` (default now). Never throws. */
export async function getRecentFilings(symbol: string, days = 10, asOf?: string): Promise<Filing[]> {
  if (!edgarEnabled()) return [];
  try {
    const cik = (await getTickerMap()).get(symbol.toUpperCase());
    if (!cik) return [];
    let entry = submissionsCache.get(cik);
    if (!entry || Date.now() - entry.at > SUBMISSIONS_TTL) {
      const subs = await edgarFetch<Submissions>(SUBMISSIONS_URL(cik));
      entry = { at: Date.now(), filings: parseRecentFilings(subs.filings.recent) };
      submissionsCache.set(cik, entry);
    }
    const endMs = asOf ? new Date(asOf).getTime() : Date.now();
    const startMs = endMs - days * 24 * 60 * 60 * 1000;
    return entry.filings.filter((f) => {
      const t = new Date(f.date).getTime();
      return t >= startMs && t <= endMs;
    });
  } catch (error) {
    log.warn(`EDGAR lookup failed for ${symbol}`, { error: (error as Error).message });
    return [];
  }
}

/** Batch with SEC's 10 req/s courtesy limit in mind. */
export async function getFilingsMany(symbols: string[], days = 10, asOf?: string): Promise<Map<string, Filing[]>> {
  const out = new Map<string, Filing[]>();
  if (!edgarEnabled() || symbols.length === 0) return out;
  const queue = [...symbols];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const sym = queue.shift()!;
      const filings = await getRecentFilings(sym, days, asOf);
      if (filings.length) out.set(sym, filings);
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  await Promise.all(workers);
  return out;
}

/** Pure: one line per filing for a prompt. */
export function formatFilings(filings: Filing[]): string[] {
  return filings.map((f) => {
    const labels = f.items.filter((i) => i !== '9.01').map((i) => `${ITEM_LABELS[i] ?? 'item'} (${i})`);
    const what = labels.length ? labels.join(', ') : f.description || f.form;
    return `${f.form} ${f.date}: ${what}`;
  });
}
