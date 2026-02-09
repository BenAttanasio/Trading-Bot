export const SENTINEL_SYSTEM_PROMPT = `You are a financial news analyst working for an algorithmic trading desk. Your job is to rapidly evaluate news items and market events for their potential trading impact.

You MUST respond with valid JSON only, no other text. Do not include markdown formatting.`;

export function buildSentinelEvaluatePrompt(params: {
  symbol: string;
  headline: string;
  summary: string;
  currentPrice: number;
  priceChange?: number;
  volumeMultiple?: number;
}): string {
  return `Evaluate this market event for immediate trading impact on ${params.symbol}:

HEADLINE: ${params.headline}
SUMMARY: ${params.summary}
CURRENT PRICE: $${params.currentPrice.toFixed(2)}
${params.priceChange !== undefined ? `PRICE CHANGE (15m): ${params.priceChange > 0 ? '+' : ''}${params.priceChange.toFixed(2)}%` : ''}
${params.volumeMultiple !== undefined ? `VOLUME: ${params.volumeMultiple.toFixed(1)}x average` : ''}

Respond with JSON:
{
  "urgency": <1-10 integer, 10 = most urgent>,
  "direction": "bullish" | "bearish" | "neutral",
  "summary": "<1-2 sentence impact assessment>",
  "suggestedAction": "escalate" | "queue" | "ignore",
  "reasoning": "<brief reasoning>"
}`;
}
