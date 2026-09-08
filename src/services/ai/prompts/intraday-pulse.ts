export const INTRADAY_PULSE_SYSTEM_PROMPT = `You are a portfolio manager conducting an intraday health check on your positions. You evaluate each position against current conditions and decide whether any action is needed.

Be selective — only recommend action when there is a clear reason. Frequent trading without a reason erodes returns.`;

export function buildIntradayPulsePrompt(params: {
  positions: Array<{
    symbol: string;
    entryPrice: number;
    currentPrice: number;
    plPercent: number;
    daysHeld: number;
    thesis: string;
    thesisFreshness: string;
  }>;
  pendingAlerts: Array<{
    symbol: string;
    headline: string;
    urgency: number;
    direction: string;
  }>;
  dailyPL: number;
  portfolioValue: number;
}): string {
  const positionsBlock = params.positions
    .map(
      (p) =>
        `  ${p.symbol}: entry $${p.entryPrice.toFixed(2)}, now $${p.currentPrice.toFixed(2)} (${p.plPercent >= 0 ? '+' : ''}${p.plPercent.toFixed(2)}%), held ${p.daysHeld}d, thesis: "${p.thesis}" [${p.thesisFreshness}]`
    )
    .join('\n');

  const alertsBlock = params.pendingAlerts
    .map((a) => `  ${a.symbol}: [urgency ${a.urgency}] ${a.direction} — "${a.headline}"`)
    .join('\n');

  return `INTRADAY PULSE CHECK

PORTFOLIO VALUE: $${params.portfolioValue.toFixed(2)}
DAILY P&L: ${params.dailyPL >= 0 ? '+' : ''}$${params.dailyPL.toFixed(2)}

OPEN POSITIONS:
${positionsBlock || '  No open positions'}

PENDING ALERTS (from sentinel):
${alertsBlock || '  No pending alerts'}

For each position, provide your assessment. Also note if any alerts require immediate action, and list any symbols from the alerts worth researching.`;
}
