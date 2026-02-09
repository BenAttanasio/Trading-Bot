import cron from 'node-cron';
import { morningResearchJob } from './jobs/morning-research';
import { intradayPulseJob } from './jobs/intraday-pulse';
import { eodSummaryJob } from './jobs/eod-summary';
import { startSentinel, stopSentinel } from './jobs/sentinel';
import { TRADING_RULES } from '../../config/trading-rules';
import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('Scheduler');

const jobs: cron.ScheduledTask[] = [];

export function startScheduler(): void {
  log.info('Starting scheduler...');

  // Morning research — 9:35 AM ET (5 minutes after market open)
  // Cron runs in server timezone; adjust if needed
  const morningJob = cron.schedule('35 9 * * 1-5', async () => {
    log.info('⏰ Triggering morning research job');
    await morningResearchJob();
  }, { timezone: 'America/New_York' });
  jobs.push(morningJob);

  // Intraday pulse — every 30 minutes during market hours (10:00-15:30 ET)
  const pulseJob = cron.schedule(`*/${TRADING_RULES.intradayPulseIntervalMinutes} 10-15 * * 1-5`, async () => {
    log.info('⏰ Triggering intraday pulse');
    await intradayPulseJob();
  }, { timezone: 'America/New_York' });
  jobs.push(pulseJob);

  // EOD summary — 4:05 PM ET (5 minutes after market close)
  const eodJob = cron.schedule('5 16 * * 1-5', async () => {
    log.info('⏰ Triggering EOD summary');
    await eodSummaryJob();
  }, { timezone: 'America/New_York' });
  jobs.push(eodJob);

  // Start sentinel (always-on polling loop)
  startSentinel();

  log.info('Scheduler started with jobs:');
  log.info('  - Morning research: 9:35 AM ET (Mon-Fri)');
  log.info(`  - Intraday pulse: every ${TRADING_RULES.intradayPulseIntervalMinutes}m during 10-15 ET`);
  log.info('  - EOD summary: 4:05 PM ET (Mon-Fri)');
  log.info(`  - Sentinel: every ${TRADING_RULES.sentinelPollIntervalSeconds}s (extended hours)`);
}

export function stopScheduler(): void {
  log.info('Stopping scheduler...');
  jobs.forEach((job) => job.stop());
  jobs.length = 0;
  stopSentinel();
  log.info('Scheduler stopped');
}
