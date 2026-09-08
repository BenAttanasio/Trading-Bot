import { buildRulesBlock, DATA_GAPS_NOTE } from './shared';

/** Built per call so runtime-tuned rules are always current (the result is cached by prefix anyway). */
export function getTradeDecisionSystemPrompt(): string {
  return `You are a disciplined quantitative trading analyst on a small systematic desk. You analyze market data and make trading decisions that will be executed automatically, so be precise and honest about uncertainty.

${buildRulesBlock()}

${DATA_GAPS_NOTE}

Whether you BUY or PASS you also make a falsifiable prediction (direction, size of move, horizon, what would invalidate it). Predictions are scored later — including the ones you passed on — so calibrate: a 0.9 confidence should be right about nine times in ten.`;
}

export function buildPositionReviewPrompt(params: {
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  plPercent: number;
  daysHeld: number;
  originalThesis: string;
  recentNews: Array<{ headline: string; date: string }>;
  rsi: number;
  volumeVsAvg: number;
  sectorPerformance: string;
}): string {
  const newsBlock = params.recentNews
    .map((n) => `  - [${n.date}] ${n.headline}`)
    .join('\n');

  return `CURRENT POSITION: ${params.symbol} — bought at $${params.entryPrice.toFixed(2)}, now $${params.currentPrice.toFixed(2)}, held ${params.daysHeld} days, ${params.plPercent >= 0 ? 'up' : 'down'} ${Math.abs(params.plPercent).toFixed(2)}%
ORIGINAL THESIS: "${params.originalThesis}"

LATEST DATA:
- RSI(14): ${params.rsi.toFixed(1)}
- Volume: ${params.volumeVsAvg.toFixed(1)}x average
- Sector: ${params.sectorPerformance}
- News:
${newsBlock || '  No significant recent news'}

Decide: HOLD, TRIM (sell half), EXIT, or ADD. Update the thesis only if the facts changed.`;
}

export function buildNewTradeDecisionPrompt(params: {
  symbol: string;
  sector: string;
  currentPrice: number;
  researchSummary: string;
  conviction: number;
  catalysts: string[];
  risks: string[];
  rsi: number | null;
  sma20: number | null;
  volumeVsAvg: number | null;
  portfolioContext: string;
  availableData?: string[];
  missingData?: string[];
}): string {
  const fmtOpt = (v: number | null, fmt: (n: number) => string) => (v !== null ? fmt(v) : 'N/A');

  const dataAvailBlock = (params.availableData || params.missingData) ? `
DATA AVAILABILITY:
- Available: ${(params.availableData || []).join(', ') || 'minimal'}
- Missing: ${(params.missingData || []).join(', ') || 'none'}
` : '';

  return `NEW TRADE OPPORTUNITY: ${params.symbol}${params.sector ? ` (${params.sector})` : ''}

RESEARCH SUMMARY: ${params.researchSummary}
RESEARCH CONVICTION: ${params.conviction}/10

CATALYSTS:
${params.catalysts.map((c) => `  - ${c}`).join('\n') || '  (none listed)'}

RISKS:
${params.risks.map((r) => `  - ${r}`).join('\n') || '  (none listed)'}

MARKET DATA:
- Current Price: $${params.currentPrice.toFixed(2)}
- RSI(14): ${fmtOpt(params.rsi, (v) => v.toFixed(1))}
- 20-Day SMA: ${fmtOpt(params.sma20, (v) => `$${v.toFixed(2)}`)}
- Volume: ${fmtOpt(params.volumeVsAvg, (v) => `${v.toFixed(1)}x average`)}
${dataAvailBlock}
PORTFOLIO CONTEXT: ${params.portfolioContext}

Should we enter this trade? If BUY, size it in dollars within the rules and state the prediction you are willing to be judged on.`;
}
