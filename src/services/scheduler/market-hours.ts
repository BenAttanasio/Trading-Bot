import { getMarketCalendar } from '../alpaca/market-data';
import { getETHour, isWeekday } from '../../utils/time';
import { TRADING_RULES } from '../../config/trading-rules';
import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('MarketHours');

export type MarketState = 'pre_market' | 'open' | 'after_hours' | 'closed';

let todayIsMarketDay: boolean | null = null;
let lastCalendarCheck = '';

async function checkMarketDay(): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  if (lastCalendarCheck === today && todayIsMarketDay !== null) {
    return todayIsMarketDay;
  }

  try {
    const calendar = await getMarketCalendar(today, today);
    todayIsMarketDay = calendar.length > 0;
    lastCalendarCheck = today;
    return todayIsMarketDay;
  } catch {
    // Fallback: assume market day if weekday
    return isWeekday();
  }
}

export async function getMarketState(): Promise<MarketState> {
  const isMarketDay = await checkMarketDay();
  if (!isMarketDay) return 'closed';

  const etHour = getETHour();

  if (etHour >= TRADING_RULES.regularHoursStart && etHour < TRADING_RULES.regularHoursEnd) {
    return 'open';
  }
  if (etHour >= TRADING_RULES.extendedHoursStart && etHour < TRADING_RULES.regularHoursStart) {
    return 'pre_market';
  }
  if (etHour >= TRADING_RULES.regularHoursEnd && etHour < TRADING_RULES.extendedHoursEnd) {
    return 'after_hours';
  }

  return 'closed';
}

export async function isRegularHours(): Promise<boolean> {
  return (await getMarketState()) === 'open';
}

export async function isExtendedHours(): Promise<boolean> {
  const state = await getMarketState();
  return state === 'pre_market' || state === 'open' || state === 'after_hours';
}

export async function logMarketState(): Promise<MarketState> {
  const state = await getMarketState();
  const etHour = getETHour();
  log.info(`Market state: ${state.toUpperCase()} (ET hour: ${etHour.toFixed(1)})`);
  return state;
}
