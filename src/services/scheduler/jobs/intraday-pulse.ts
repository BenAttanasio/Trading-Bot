import { runIntradayPulse } from '../../../engine/orchestrator';
import { isExtendedHours, getMarketState } from '../market-hours';
import { createServiceLogger } from '../../../utils/logger';

const log = createServiceLogger('IntradayPulseJob');

export async function intradayPulseJob(): Promise<void> {
  const inHours = await isExtendedHours();
  if (!inHours) {
    log.info('Outside extended hours — skipping intraday pulse');
    return;
  }

  const state = await getMarketState();
  log.info(`Running intraday pulse (market: ${state})`);
  await runIntradayPulse();
}
