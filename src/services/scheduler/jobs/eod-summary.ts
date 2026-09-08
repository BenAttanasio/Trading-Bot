import { getAccount } from '../../alpaca/client';
import { getPositions } from '../../alpaca/trading';
import { callAIStructured } from '../../ai/client';
import { EodSummarySchema, normalizeEodSummary } from '../../ai/schemas';
import { EOD_SUMMARY_SYSTEM_PROMPT, buildEodSummaryPrompt } from '../../ai/prompts/eod-summary';
import { getTradesToday, getDecisionsToday, getRecentAlerts, upsertDailySummary, getAllPositions } from '../../db/queries';
import { getStartingEquity } from '../../db/bot-state';
import { recordDailyBenchmark } from '../../../engine/benchmark';
import { DailySummary } from '../../db/models/daily-summary';
import { getETDateISO } from '../../../utils/time';
import { createServiceLogger } from '../../../utils/logger';

const log = createServiceLogger('EodSummaryJob');

export async function eodSummaryJob(): Promise<void> {
  log.info('Generating end-of-day summary...');

  try {
    const [account, alpacaPositions, tradesToday, decisionsToday, alerts, dbPositions, startingEquity] = await Promise.all([
      getAccount(),
      getPositions(),
      getTradesToday(),
      getDecisionsToday(),
      getRecentAlerts(100),
      getAllPositions(),
      getStartingEquity(),
    ]);

    const portfolioValue = parseFloat(account.portfolio_value);
    const cashBalance = parseFloat(account.cash);
    const lastEquity = parseFloat(account.last_equity);
    const dailyPL = portfolioValue - lastEquity;
    const dailyPLPercent = lastEquity > 0 ? (dailyPL / lastEquity) * 100 : 0;
    const investedValue = parseFloat(account.long_market_value);
    // Total P&L is measured against the equity captured on first boot (or STARTING_EQUITY).
    const totalPL = startingEquity ? portfolioValue - startingEquity : dailyPL;

    const tradesBlocked = decisionsToday.filter((d) => d.decision === 'BLOCKED').length;
    const todayISO = getETDateISO();
    const todayAlerts = alerts.filter((a) => getETDateISO(new Date(a.createdAt)) === todayISO);

    // Find top and worst mover
    let topMover: { symbol: string; pl: number } | null = null;
    let worstMover: { symbol: string; pl: number } | null = null;
    for (const pos of alpacaPositions) {
      const pl = parseFloat(pos.unrealized_pl);
      if (!topMover || pl > topMover.pl) topMover = { symbol: pos.symbol, pl };
      if (!worstMover || pl < worstMover.pl) worstMover = { symbol: pos.symbol, pl };
    }

    const eodResult = normalizeEodSummary(
      await callAIStructured({
        schema: EodSummarySchema,
        systemPrompt: EOD_SUMMARY_SYSTEM_PROMPT,
        userPrompt: buildEodSummaryPrompt({
          date: todayISO,
          portfolioValue,
          cashBalance,
          dailyPL,
          dailyPLPercent,
          totalPL,
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
        effort: 'low',
        purpose: 'eod-summary',
      })
    );

    const summary: DailySummary = {
      date: todayISO,
      portfolioValue,
      cashBalance,
      investedValue,
      dailyPL,
      dailyPLPercent,
      totalPL,
      tradesExecuted: tradesToday.length,
      tradesBlocked,
      sentinelAlerts: todayAlerts.length,
      topMover,
      worstMover,
      aiSummary: eodResult.summary,
      createdAt: new Date(),
    };

    await upsertDailySummary(summary);
    await recordDailyBenchmark(todayISO, portfolioValue).catch((err) => log.error('Benchmark capture failed', { err }));
    log.info('End-of-day summary generated and stored', {
      dailyPL: dailyPL.toFixed(2),
      totalPL: totalPL.toFixed(2),
      trades: tradesToday.length,
    });
  } catch (error) {
    log.error('EOD summary generation failed', { error });
  }
}
