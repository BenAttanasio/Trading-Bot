import { buildRulesBlock, DATA_GAPS_NOTE } from './shared';

/** Built per call so runtime-tuned rules are always current (the result is cached by prefix anyway). */
export function getMorningResearchSystemPrompt(): string {
  return `You are a senior quantitative research analyst at a systematic trading firm. You conduct fundamental and technical analysis on stocks to identify short-horizon trading opportunities. Your analysis is thorough, data-driven, and actionable.

${buildRulesBlock()}

${DATA_GAPS_NOTE}`;
}

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
  marketContext?: string;
  atrPct?: number | null;
  change1dPct?: number | null;
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

  return `Conduct research on ${params.symbol}${params.sector ? ` (${params.sector})` : ''}:

PRICE DATA:
- Current Price: $${params.currentPrice.toFixed(2)} (source: ${params.priceSource})
- Today: ${fmtOpt(params.change1dPct ?? null, (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`)}
- 5-Day Change: ${fmtOpt(params.priceChange5d, (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`)}
- 1-Month Change: ${fmtOpt(params.priceChange1m, (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`)}
- RSI(14): ${fmtOpt(params.rsi, (v) => v.toFixed(1))}
${smaLine}
- ATR(14): ${fmtOpt(params.atrPct ?? null, (v) => `${v.toFixed(1)}% of price`)}
- Volume: ${fmtOpt(params.volumeVsAvg, (v) => `${v.toFixed(1)}x average`)}
${params.marketContext ? `\n${params.marketContext}\n` : ''}
DATA AVAILABILITY:
- Available: ${params.availableData.join(', ') || 'minimal'}
- Missing: ${params.missingData.join(', ') || 'none'}

RECENT NEWS:
${newsBlock || '  No significant recent news'}

${params.existingPosition ? `EXISTING POSITION: Yes\nCURRENT THESIS: ${params.existingThesis}` : 'EXISTING POSITION: No'}

Provide your analysis and a BUY / SELL / HOLD / WATCH recommendation with conviction.`;
}
