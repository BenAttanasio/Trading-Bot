import { buildRulesBlock, DATA_GAPS_NOTE } from './shared';

/**
 * One call, every candidate: the model sees the whole slate side by side plus
 * the market context, and ranks. Replaces N isolated research calls.
 */
export function getRankingSystemPrompt(): string {
  return `You are the head of research on a small systematic desk. Every morning you rank a slate of candidate stocks against each other and against the market for a 1-30 day horizon, and you are judged on calibration: your stated confidence must match your hit rate.

${buildRulesBlock()}

${DATA_GAPS_NOTE}

How to rank:
- Edge comes from (a) a concrete, dated catalyst the market has not fully priced, confirmed by price/volume; or (b) unusual relative strength/weakness vs SPY and the sector with a plausible driver. A name that is up because its sector is up has no edge of its own.
- Score every symbol on -10..+10. Most names should sit near 0 with side "none". Reserve |score| >= 6 for setups you would defend to a skeptic.
- Give an invalidation price (the stop) and a target for every non-zero side. The stop must be on the losing side of the current price and within 15% of it; the target on the winning side. Prefer stops at a real level (recent low/high, ATR multiple) over round numbers.
- Extended moves: a name already up > 8% today or RSI > 75 needs an exceptional catalyst to be long; the same in reverse for shorts. Do not chase.
- Horizon is trading days. Predictions are scored at the horizon, so pick the horizon the catalyst actually needs.
- If shorts are not allowed, still score bearish names negatively but set side "none"; the score is informative.`;
}

export interface RankingCandidateInput {
  symbol: string;
  sector: string;
  source: string;
  note: string;
  price: number;
  change1dPct: number | null;
  change5dPct: number | null;
  change1mPct: number | null;
  relStrength5dPct: number | null;
  rsi: number | null;
  sma20: number | null;
  atrPct: number | null;
  volumeVsAvg: number | null;
  news: Array<{ headline: string; date: string }>;
  held: 'long' | 'short' | null;
}

const fmt = (v: number | null, d = 1) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);

export function buildRankingPrompt(params: {
  dateISO: string;
  marketContext: string;
  candidates: RankingCandidateInput[];
  maxLongs: number;
  maxShorts: number;
  shortsEnabled: boolean;
  initialDeploymentNote?: string;
}): string {
  const rows = params.candidates.map((c) => {
    const news = c.news.slice(0, 5).map((n) => `      - [${n.date}] ${n.headline}`).join('\n');
    const trend = c.sma20 == null ? 'SMA20 n/a' : c.price > c.sma20 ? 'above SMA20' : 'below SMA20';
    return `  ${c.symbol}${c.sector ? ` (${c.sector})` : ''} — $${c.price.toFixed(2)} | 1d ${fmt(c.change1dPct)} 5d ${fmt(c.change5dPct)} 1m ${fmt(c.change1mPct)} | RS vs SPY 5d ${fmt(c.relStrength5dPct)} | RSI ${c.rsi == null ? 'n/a' : c.rsi.toFixed(0)} | ${trend} | ATR ${c.atrPct == null ? 'n/a' : c.atrPct.toFixed(1) + '%'} | vol ${c.volumeVsAvg == null ? 'n/a' : c.volumeVsAvg.toFixed(1) + 'x'} | source: ${c.note}${c.held ? ` | HELD ${c.held.toUpperCase()}` : ''}
${news || '      (no recent news)'}`;
  });

  return `MORNING RANKING — ${params.dateISO}

${params.marketContext}
${params.initialDeploymentNote ? `\n${params.initialDeploymentNote}\n` : ''}
CANDIDATES (${params.candidates.length}):
${rows.join('\n')}

We will take at most ${params.maxLongs} longs${params.shortsEnabled ? ` and ${params.maxShorts} shorts` : ''} from the top of your ranking, then run a final per-name check before entry. Names already HELD are for context (do not re-recommend the same side; you may flag the opposite side if the thesis broke).

Return one entry per candidate symbol with side, score, conviction, confidence, horizon, expected move, thesis, catalysts, risks, invalidation price and target.`;
}
