import { runIntradayPulse } from '../../../engine/orchestrator';
import { isRegularHours } from '../market-hours';
import { createServiceLogger } from '../../../utils/logger';

const log = createServiceLogger('IntradayPulseJob');

export async function intradayPulseJob(): Promise<void> {
  const marketOpen = await isRegularHours();
  if (!marketOpen) {
    log.info('Market closed — skipping intraday pulse');
    return;
  }

  await runIntradayPulse();
}
