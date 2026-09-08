import { runPortfolioReview } from './portfolio-manager';
import { runMorningResearch, researchAndTrade, runIntradayScouting } from './scout';
import { isTradingPaused } from './execution';
import { runStopGuard } from './stop-guard';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('Orchestrator');

/**
 * Coordinates the different trading workflows.
 * Acts as the central dispatcher — nothing trades without going through here.
 */

// Prevent overlapping cycle runs (e.g., if a pulse takes longer than its cron interval)
let cycleRunning = false;

export async function runMorningCycle(): Promise<void> {
  if (isTradingPaused()) {
    log.warn('Morning cycle skipped — trading paused');
    return;
  }
  if (cycleRunning) {
    log.warn('Morning cycle skipped — previous cycle still running');
    return;
  }

  cycleRunning = true;
  log.info('═══ MORNING RESEARCH CYCLE ═══');
  try {
    // Code-enforced exits first, then review what is left
    await runStopGuard();
    await runPortfolioReview();

    // Then, scout for new opportunities
    await runMorningResearch();

    log.info('═══ MORNING CYCLE COMPLETE ═══');
  } catch (error) {
    log.error('Morning cycle failed', { error });
  } finally {
    cycleRunning = false;
  }
}

export async function runIntradayPulse(): Promise<void> {
  if (isTradingPaused()) {
    log.warn('Intraday pulse skipped — trading paused');
    return;
  }
  if (cycleRunning) {
    log.warn('Intraday pulse skipped — previous cycle still running');
    return;
  }

  cycleRunning = true;
  log.info('─── INTRADAY PULSE ───');
  try {
    await runStopGuard();
    await runPortfolioReview();
    await runIntradayScouting();
    log.info('─── PULSE COMPLETE ───');
  } catch (error) {
    log.error('Intraday pulse failed', { error });
  } finally {
    cycleRunning = false;
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
