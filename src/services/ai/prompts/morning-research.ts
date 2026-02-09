export const MORNING_RESEARCH_SYSTEM_PROMPT = `You are a senior quantitative research analyst at a systematic trading firm. You conduct deep fundamental and technical analysis on stocks to identify trading opportunities.

Your analysis should be thorough, data-driven, and actionable. You manage a portfolio with these constraints:
- Max position size: $50 per stock
- Risk tolerance: moderate
- Style: momentum + sentiment hybrid
- Time horizon: 1-30 days per trade
- Focus: US large-cap and mid-cap equities

IMPORTANT: Some data fields may be listed as "N/A (insufficient data)". This is normal during after-hours or for newly listed stocks. Base your analysis on whatever data IS available — news sentiment and current price alone can be sufficient for a preliminary recommendation. Do NOT refuse to analyze just because technical indicators are missing.

You MUST respond with valid JSON only, no other text. Do not include markdown formatting.`;

export interface MorningResearchPromptParams {
  symbol: string;
  sector: string;
  currentPrice: number;
  priceSource: string;
  priceChange5d: number | null;
  priceChange1m: number | null;
  rsi: number | null;
  sma20: number | null;
  volumeVsAvg: number | null;
  recentNews: Array<{ headline: string; date: string }>;
  existingPosition: boolean;
  existingThesis?: string;
  availableData: string[];
  missingData: string[];
}

function fmtOpt(value: number | null, formatter: (v: number) => string, fallback = 'N/A (insufficient data)'): string {
  return value !== null ? formatter(value) : fallback;
}

export function buildMorningResearchPrompt(params: MorningResearchPromptParams): string {
  const newsBlock = params.recentNews
    .map((n) => `  - [${n.date}] ${n.headline}`)
    .join('\n');

  const smaLine = params.sma20 !== null
    ? `- 20-Day SMA: $${params.sma20.toFixed(2)} (price ${params.currentPrice > params.sma20 ? 'ABOVE' : 'BELOW'} SMA)`
    : '- 20-Day SMA: N/A (insufficient data)';

  return `Conduct deep research analysis on ${params.symbol} (${params.sector}):

PRICE DATA:
- Current Price: $${params.currentPrice.toFixed(2)} (source: ${params.priceSource})
- 5-Day Change: ${fmtOpt(params.priceChange5d, v => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`)}
- 1-Month Change: ${fmtOpt(params.priceChange1m, v => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`)}
- RSI(14): ${fmtOpt(params.rsi, v => v.toFixed(1))}
${smaLine}
- Volume: ${fmtOpt(params.volumeVsAvg, v => `${v.toFixed(1)}x average`)}

DATA AVAILABILITY:
- Available: ${params.availableData.join(', ') || 'minimal'}
- Missing: ${params.missingData.join(', ') || 'none'}

RECENT NEWS:
${newsBlock || '  No significant recent news'}

${params.existingPosition ? `EXISTING POSITION: Yes\nCURRENT THESIS: ${params.existingThesis}` : 'EXISTING POSITION: No'}

Provide your analysis as JSON:
{
  "symbol": "${params.symbol}",
  "sentiment": "bullish" | "bearish" | "neutral",
  "conviction": <1-10>,
  "summary": "<2-3 sentence summary>",
  "catalysts": ["<catalyst 1>", "<catalyst 2>"],
  "risks": ["<risk 1>", "<risk 2>"],
  "technicalOutlook": "<1-2 sentences on technicals, or note if data unavailable>",
  "fundamentalOutlook": "<1-2 sentences on fundamentals>",
  "recommendation": "BUY" | "SELL" | "HOLD" | "WATCH",
  "priceTarget": "<target price or null>",
  "stopLoss": "<stop loss price or null>",
  "timeHorizon": "<e.g., '1-2 weeks'>",
  "positionSizeRecommendation": <dollar amount, max 50>
}`;
}
