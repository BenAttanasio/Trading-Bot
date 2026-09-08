import { buildRulesBlock, DATA_GAPS_NOTE } from './shared';

/** Built per call so runtime-tuned rules are always current (the result is cached by prefix anyway). */
export function getTradeDecisionSystemPrompt(): string {
  return `You are a disciplined quantitative trading analyst on a small systematic desk. You analyze market data and make trading decisions that will be executed automatically, so be precise and honest about uncertainty.

${buildRulesBlock()}

${DATA_GAPS_NOTE}

Whether you BUY or PASS you also make a falsifiable prediction (direction, size of move, horizon, what would invalidate it). Predictions are scored later — including the ones you passed on — so calibrate: a 0.9 confidence should be right about nine times in ten. For a short, the prediction direction is "down".`;
}

export function buildPositionReviewPrompt(params: {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  plPercent: number;
  daysHeld: number;
  originalThesis: string;
  recentNews: Array<{ headline: string; date: string }>;
  rsi: number;
  volumeVsAvg: number;
  sectorPerformance: string;
  stopPrice?: number | null;
  targetPrice?: number | null;
  timeStopAt?: Date | null;
  marketContext?: string;
}): string {
  const newsBlock = params.recentNews
    .map((n) => `  - [${n.date}] ${n.headline}`)
    .join('\n');
  const guard = [
    params.stopPrice != null ? `stop $${params.stopPrice.toFixed(2)}` : 'no hard stop',
    params.targetPrice != null ? `target $${params.targetPrice.toFixed(2)}` : 'no target',
    params.timeStopAt ? `time stop ${params.timeStopAt.toISOString().slice(0, 10)}` : 'no time stop',
  ].join(', ');

  return `CURRENT POSITION: ${params.side.toUpperCase()} ${params.symbol} — entered at $${params.entryPrice.toFixed(2)}, now $${params.currentPrice.toFixed(2)}, held ${params.daysHeld} days, ${params.plPercent >= 0 ? 'up' : 'down'} ${Math.abs(params.plPercent).toFixed(2)}%
ORIGINAL THESIS: "${params.originalThesis}"
CODE-ENFORCED EXITS: ${guard} (these fire without you; you may only tighten the stop)

LATEST DATA:
- RSI(14): ${params.rsi.toFixed(1)}
- Volume: ${params.volumeVsAvg.toFixed(1)}x average
- Sector: ${params.sectorPerformance}
- News:
${newsBlock || '  No significant recent news'}
${params.marketContext ? `\n${params.marketContext}\n` : ''}
Decide: HOLD, TRIM (close half), EXIT, or ADD. Update the thesis only if the facts changed. If the facts argue for less risk but not an exit, propose a tighter stop.`;
}

export function buildNewTradeDecisionPrompt(params: {
  symbol: string;
  sector: string;
  side: 'long' | 'short';
  currentPrice: number;
  researchSummary: string;
  conviction: number;
  catalysts: string[];
  risks: string[];
  proposedStop: number | null;
  proposedTarget: number | null;
  horizonDays: number | null;
  rsi: number | null;
  sma20: number | null;
  atr: number | null;
  atrPct: number | null;
  volumeVsAvg: number | null;
  change1dPct: number | null;
  portfolioContext: string;
  marketContext?: string;
  availableData?: string[];
  missingData?: string[];
}): string {
  const fmtOpt = (v: number | null, fmt: (n: number) => string) => (v !== null ? fmt(v) : 'N/A');

  const dataAvailBlock = (params.availableData || params.missingData) ? `
DATA AVAILABILITY:
- Available: ${(params.availableData || []).join(', ') || 'minimal'}
- Missing: ${(params.missingData || []).join(', ') || 'none'}
` : '';

  return `NEW TRADE CANDIDATE: ${params.side.toUpperCase()} ${params.symbol}${params.sector ? ` (${params.sector})` : ''}

RESEARCH SUMMARY: ${params.researchSummary}
RESEARCH CONVICTION: ${params.conviction}/10
PROPOSED BY RESEARCH: stop ${params.proposedStop == null ? 'n/a' : '$' + params.proposedStop.toFixed(2)}, target ${params.proposedTarget == null ? 'n/a' : '$' + params.proposedTarget.toFixed(2)}, horizon ${params.horizonDays ?? 'n/a'} trading days

CATALYSTS:
${params.catalysts.map((c) => `  - ${c}`).join('\n') || '  (none listed)'}

RISKS:
${params.risks.map((r) => `  - ${r}`).join('\n') || '  (none listed)'}

MARKET DATA:
- Current Price: $${params.currentPrice.toFixed(2)} (today ${fmtOpt(params.change1dPct, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`)})
- RSI(14): ${fmtOpt(params.rsi, (v) => v.toFixed(1))}
- 20-Day SMA: ${fmtOpt(params.sma20, (v) => `$${v.toFixed(2)}`)}
- ATR(14): ${fmtOpt(params.atr, (v) => `$${v.toFixed(2)}`)} (${fmtOpt(params.atrPct, (v) => `${v.toFixed(1)}% of price`)})
- Volume: ${fmtOpt(params.volumeVsAvg, (v) => `${v.toFixed(1)}x average`)}
${dataAvailBlock}${params.marketContext ? `\n${params.marketContext}\n` : ''}
PORTFOLIO CONTEXT: ${params.portfolioContext}

Should we enter this ${params.side}? If BUY, give the stop price (losing side, within 15%; a real level, roughly 1.5-3 ATR away), the target price, the horizon, and the prediction you are willing to be judged on. Code will size the position from the stop distance.`;
}
