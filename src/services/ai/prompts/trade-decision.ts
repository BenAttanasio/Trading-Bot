export const TRADE_DECISION_SYSTEM_PROMPT = `You are a disciplined quantitative trading analyst. You analyze market data and make trading decisions. You MUST respond with valid JSON only, no other text. Do not include markdown formatting.

You manage a portfolio with these rules:
- Max position size: $50
- Risk tolerance: moderate
- Style: momentum + sentiment hybrid
- Time horizon: 1-30 days per trade

IMPORTANT: Some market data fields may show "N/A" when historical bars are unavailable (common during after-hours or for sentinel-escalated events). Make your decision based on whatever data IS available — a strong news catalyst with current price is sufficient to act on. Do NOT default to PASS just because technical indicators are missing.`;

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

What is your decision?

Respond with JSON:
{
  "action": "HOLD" | "TRIM" | "EXIT" | "ADD",
  "conviction": <1-10>,
  "reasoning": "<2-3 sentence explanation>",
  "thesisUpdate": "<updated thesis if changed, or null>",
  "exitConditions": {
    "profitTarget": "<$ or %>" ,
    "stopLoss": "<$ or %>"
  },
  "nextReviewIn": "30m" | "1h" | "4h" | "next_pulse"
}`;
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
  const fmtOpt = (v: number | null, fmt: (n: number) => string) => v !== null ? fmt(v) : 'N/A';

  const dataAvailBlock = (params.availableData || params.missingData) ? `
DATA AVAILABILITY:
- Available: ${(params.availableData || []).join(', ') || 'minimal'}
- Missing: ${(params.missingData || []).join(', ') || 'none'}
` : '';

  return `NEW TRADE OPPORTUNITY: ${params.symbol} (${params.sector})

RESEARCH SUMMARY: ${params.researchSummary}
RESEARCH CONVICTION: ${params.conviction}/10

CATALYSTS:
${params.catalysts.map((c) => `  - ${c}`).join('\n')}

RISKS:
${params.risks.map((r) => `  - ${r}`).join('\n')}

MARKET DATA:
- Current Price: $${params.currentPrice.toFixed(2)}
- RSI(14): ${fmtOpt(params.rsi, v => v.toFixed(1))}
- 20-Day SMA: ${fmtOpt(params.sma20, v => `$${v.toFixed(2)}`)}
- Volume: ${fmtOpt(params.volumeVsAvg, v => `${v.toFixed(1)}x average`)}
${dataAvailBlock}
PORTFOLIO CONTEXT: ${params.portfolioContext}

Should we enter this trade?

Respond with JSON:
{
  "action": "BUY" | "PASS",
  "conviction": <1-10>,
  "reasoning": "<2-3 sentence explanation>",
  "entryStrategy": "market" | "limit",
  "limitPrice": <price or null>,
  "positionSize": <dollar amount, max 50>,
  "thesis": "<investment thesis>",
  "exitConditions": {
    "profitTarget": "<$ or %>",
    "stopLoss": "<$ or %>"
  },
  "timeHorizon": "<e.g., '1-2 weeks'>"
}`;
}
