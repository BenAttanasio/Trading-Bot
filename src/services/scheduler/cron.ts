import cron from 'node-cron';
import { morningResearchJob } from './jobs/morning-research';
import { intradayPulseJob } from './jobs/intraday-pulse';
import { eodSummaryJob } from './jobs/eod-summary';
import { startSentinel, stopSentinel } from './jobs/sentinel';
import { runNightlyReflection, runWeeklyReview } from '../../engine/reflection';
import { runSelfImprove } from '../../engine/self-improve';
import { TRADING_RULES } from '../../config/trading-rules';
import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('Scheduler');

const jobs: cron.ScheduledTask[] = [];
const TZ = { timezone: 'America/New_York' };

export function startScheduler(): void {
  log.info('Starting scheduler...');

  // Morning research — 9:35 AM ET (5 minutes after market open)
  jobs.push(cron.schedule('35 9 * * 1-5', async () => {
    log.info('⏰ Triggering morning research job');
    await morningResearchJob();
  }, TZ));

  // Intraday pulse — every N minutes during extended hours (4:00 AM - 7:55 PM ET)
  jobs.push(cron.schedule(`*/${TRADING_RULES.intradayPulseIntervalMinutes} 4-19 * * 1-5`, async () => {
    log.info('⏰ Triggering intraday pulse');
    await intradayPulseJob();
  }, TZ));

  // EOD summary + benchmark capture — 4:05 PM ET
  jobs.push(cron.schedule('5 16 * * 1-5', async () => {
    log.info('⏰ Triggering EOD summary');
    await eodSummaryJob();
  }, TZ));

  // Nightly reflection — 7:00 PM ET (after-hours news has settled, before the next session)
  jobs.push(cron.schedule('0 19 * * 1-5', async () => {
    log.info('⏰ Triggering nightly reflection');
    await runNightlyReflection();
  }, TZ));

  // Weekly deep review — Sunday 10:00 AM ET
  jobs.push(cron.schedule('0 10 * * 0', async () => {
    log.info('⏰ Triggering weekly deep review');
    await runWeeklyReview();
  }, TZ));

  // Self-improvement — Sunday 11:30 AM ET (after the weekly review) and a weekday evening sweep
  jobs.push(cron.schedule('30 11 * * 0', async () => {
    log.info('⏰ Triggering self-improve');
    await runSelfImprove();
  }, TZ));
  jobs.push(cron.schedule('30 20 * * 1-5', async () => {
    await runSelfImprove();
  }, TZ));

  // Start sentinel (always-on polling loop)
  startSentinel();

  log.info('Scheduler started with jobs:');
  log.info('  - Morning research: 9:35 AM ET (Mon-Fri)');
  log.info(`  - Intraday pulse: every ${TRADING_RULES.intradayPulseIntervalMinutes}m during 4-19 ET (extended hours)`);
  log.info('  - EOD summary + benchmark: 4:05 PM ET (Mon-Fri)');
  log.info('  - Nightly reflection: 7:00 PM ET (Mon-Fri)');
  log.info('  - Weekly deep review: Sunday 10:00 AM ET');
  log.info('  - Self-improve: Sunday 11:30 AM ET + weekdays 8:30 PM ET (change requests only)');
  log.info(`  - Sentinel: every ${TRADING_RULES.sentinelPollIntervalSeconds}s (extended hours)`);
}

export function stopScheduler(): void {
  log.info('Stopping scheduler...');
  jobs.forEach((job) => job.stop());
  jobs.length = 0;
  stopSentinel();
  log.info('Scheduler stopped');
}
