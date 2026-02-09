import { runMorningCycle } from '../../../engine/orchestrator';
import { isRegularHours } from '../market-hours';
import { createServiceLogger } from '../../../utils/logger';

const log = createServiceLogger('MorningResearchJob');

export async function morningResearchJob(): Promise<void> {
  log.info('Morning research job triggered');

  const marketOpen = await isRegularHours();
  if (!marketOpen) {
    log.info('Market not open yet — deferring morning research');
    return;
  }

  await runMorningCycle();
}
