import { getAccount } from '../../alpaca/client';
import { getPositions } from '../../alpaca/trading';
import { callAIJson } from '../../ai/client';
import { EOD_SUMMARY_SYSTEM_PROMPT, buildEodSummaryPrompt } from '../../ai/prompts/eod-summary';
import { parseEodSummary } from '../../ai/parser';
import { getTradesToday, getDecisionsToday, getRecentAlerts, upsertDailySummary, getAllPositions } from '../../db/queries';
import { DailySummary } from '../../db/models/daily-summary';
import { createServiceLogger } from '../../../utils/logger';

const log = createServiceLogger('EodSummaryJob');

export async function eodSummaryJob(): Promise<void> {
  log.info('Generating end-of-day summary...');

  try {
    const [account, alpacaPositions, tradesToday, decisionsToday, alerts, dbPositions] = await Promise.all([
      getAccount(),
      getPositions(),
      getTradesToday(),
      getDecisionsToday(),
      getRecentAlerts(100),
      getAllPositions(),
    ]);

    const portfolioValue = parseFloat(account.portfolio_value);
    const cashBalance = parseFloat(account.cash);
    const lastEquity = parseFloat(account.last_equity);
    const dailyPL = portfolioValue - lastEquity;
    const dailyPLPercent = lastEquity > 0 ? (dailyPL / lastEquity) * 100 : 0;
    const investedValue = parseFloat(account.long_market_value);

    const tradesBlocked = decisionsToday.filter((d) => d.decision === 'BLOCKED').length;
    const todayAlerts = alerts.filter(
      (a) => new Date(a.createdAt).toDateString() === new Date().toDateString()
    );

    // Find top and worst mover
    let topMover: { symbol: string; pl: number } | null = null;
    let worstMover: { symbol: string; pl: number } | null = null;
    for (const pos of alpacaPositions) {
      const pl = parseFloat(pos.unrealized_pl);
      if (!topMover || pl > topMover.pl) topMover = { symbol: pos.symbol, pl };
      if (!worstMover || pl < worstMover.pl) worstMover = { symbol: pos.symbol, pl };
    }

    // Generate AI summary
    const aiResponse = await callAIJson<Record<string, unknown>>({
      systemPrompt: EOD_SUMMARY_SYSTEM_PROMPT,
      userPrompt: buildEodSummaryPrompt({
        date: new Date().toISOString().split('T')[0],
        portfolioValue,
        cashBalance,
        dailyPL,
        dailyPLPercent,
        totalPL: portfolioValue - 100000, // Assuming 100k starting (paper)
        tradesExecuted: tradesToday.map((t) => ({
          symbol: t.symbol,
          action: t.action,
          notional: t.notional,
          reasoning: t.aiReasoning,
        })),
        tradesBlocked,
        openPositions: dbPositions.map((p) => ({
          symbol: p.symbol,
          plPercent: p.unrealizedPLPercent,
          daysHeld: p.daysHeld,
          thesis: p.thesis,
        })),
        sentinelAlerts: todayAlerts.length,
        marketConditions: 'Standard trading day', // simplified
      }),
      model: 'fast',
      maxTokens: 2048,
    });

    const eodResult = parseEodSummary(aiResponse);

    // Store daily summary
    const summary: DailySummary = {
      date: new Date().toISOString().split('T')[0],
      portfolioValue,
      cashBalance,
      investedValue,
      dailyPL,
      dailyPLPercent,
      totalPL: portfolioValue - lastEquity,
      tradesExecuted: tradesToday.length,
      tradesBlocked,
      sentinelAlerts: todayAlerts.length,
      topMover,
      worstMover,
      aiSummary: eodResult.summary,
      createdAt: new Date(),
    };

    await upsertDailySummary(summary);
    log.info('End-of-day summary generated and stored', {
      dailyPL: dailyPL.toFixed(2),
      trades: tradesToday.length,
    });
  } catch (error) {
    log.error('EOD summary generation failed', { error });
  }
}
