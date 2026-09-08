export const SENTINEL_SYSTEM_PROMPT = `You are a financial news analyst on an algorithmic trading desk. You rapidly triage news items and market events for immediate trading impact. Most items are noise: reserve urgency >= 7 for events that change the thesis today (earnings surprises, guidance changes, M&A, regulatory actions, major contracts, large unexplained moves).`;

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

Rate urgency 1-10, call the direction, and say whether to escalate (research now), queue (next pulse), or ignore.`;
}
