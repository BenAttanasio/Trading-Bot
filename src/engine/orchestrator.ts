import { runPortfolioReview } from './portfolio-manager';
import { runMorningResearch, researchAndTrade } from './scout';
import { isTradingPaused } from './execution';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('Orchestrator');

/**
 * Coordinates the different trading workflows.
 * Acts as the central dispatcher — nothing trades without going through here.
 */

export async function runMorningCycle(): Promise<void> {
  if (isTradingPaused()) {
    log.warn('Morning cycle skipped — trading paused');
    return;
  }

  log.info('═══ MORNING RESEARCH CYCLE ═══');
  try {
    // First, review existing positions
    await runPortfolioReview();

    // Then, scout for new opportunities
    await runMorningResearch();

    log.info('═══ MORNING CYCLE COMPLETE ═══');
  } catch (error) {
    log.error('Morning cycle failed', { error });
  }
}

export async function runIntradayPulse(): Promise<void> {
  if (isTradingPaused()) {
    log.warn('Intraday pulse skipped — trading paused');
    return;
  }

  log.info('─── INTRADAY PULSE ───');
  try {
    await runPortfolioReview();
    log.info('─── PULSE COMPLETE ───');
  } catch (error) {
    log.error('Intraday pulse failed', { error });
  }
}

export async function handleSentinelEscalation(
  symbol: string,
  sector: string,
  headline: string,
  urgency: number,
  direction: string
): Promise<void> {
  if (isTradingPaused()) {
    log.warn(`Sentinel escalation skipped (paused): ${symbol} — ${headline}`);
    return;
  }

  log.info(`⚡ SENTINEL ESCALATION: ${symbol} [urgency ${urgency}] ${direction}`, {
    headline,
  });

  try {
    await researchAndTrade(symbol, sector, 'sentinel');
  } catch (error) {
    log.error(`Sentinel escalation failed for ${symbol}`, { error });
  }
}
