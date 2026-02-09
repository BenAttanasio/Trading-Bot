export const EOD_SUMMARY_SYSTEM_PROMPT = `You are a portfolio manager writing an end-of-day trading report. Be concise, data-driven, and honest about both wins and losses. Focus on what you learned and what to watch tomorrow.

You MUST respond with valid JSON only, no other text. Do not include markdown formatting.`;

export function buildEodSummaryPrompt(params: {
  date: string;
  portfolioValue: number;
  cashBalance: number;
  dailyPL: number;
  dailyPLPercent: number;
  totalPL: number;
  tradesExecuted: Array<{
    symbol: string;
    action: string;
    notional: number;
    reasoning: string;
  }>;
  tradesBlocked: number;
  openPositions: Array<{
    symbol: string;
    plPercent: number;
    daysHeld: number;
    thesis: string;
  }>;
  sentinelAlerts: number;
  marketConditions: string;
}): string {
  const tradesBlock = params.tradesExecuted
    .map(
      (t) => `  ${t.action} ${t.symbol} ($${t.notional.toFixed(2)}): ${t.reasoning}`
    )
    .join('\n');

  const positionsBlock = params.openPositions
    .map(
      (p) => `  ${p.symbol}: ${p.plPercent >= 0 ? '+' : ''}${p.plPercent.toFixed(2)}%, ${p.daysHeld}d held — "${p.thesis}"`
    )
    .join('\n');

  return `END OF DAY REPORT — ${params.date}

PORTFOLIO SUMMARY:
- Portfolio Value: $${params.portfolioValue.toFixed(2)}
- Cash: $${params.cashBalance.toFixed(2)}
- Daily P&L: ${params.dailyPL >= 0 ? '+' : ''}$${params.dailyPL.toFixed(2)} (${params.dailyPLPercent >= 0 ? '+' : ''}${params.dailyPLPercent.toFixed(2)}%)
- Total P&L: ${params.totalPL >= 0 ? '+' : ''}$${params.totalPL.toFixed(2)}

TRADES EXECUTED TODAY:
${tradesBlock || '  No trades executed'}
Trades blocked by risk manager: ${params.tradesBlocked}

OPEN POSITIONS:
${positionsBlock || '  No open positions'}

MARKET CONDITIONS: ${params.marketConditions}
SENTINEL ALERTS TODAY: ${params.sentinelAlerts}

Write an end-of-day summary. Respond with JSON:
{
  "summary": "<3-5 sentence recap of the day>",
  "keyDecisions": ["<notable decision 1>", "<notable decision 2>"],
  "lessonsLearned": ["<lesson 1>", "<lesson 2>"],
  "watchTomorrow": ["<thing to watch 1>", "<thing to watch 2>"],
  "riskAssessment": "<1-2 sentences on current risk posture>",
  "confidenceLevel": <1-10, how confident are you in current positions>
}`;
}
