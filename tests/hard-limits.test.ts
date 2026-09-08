import { describe, it, expect } from 'vitest';
import { HARD_LIMITS, TUNABLE_BOUNDS, clampTunable, isTunableKey } from '../src/config/hard-limits';

describe('hard limits', () => {
  it('never lets tunable bounds exceed the hard ceilings', () => {
    expect(TUNABLE_BOUNDS.maxDailyLossPercent.max).toBeLessThanOrEqual(HARD_LIMITS.maxDailyLossPercent);
    expect(TUNABLE_BOUNDS.maxDailyTrades.max).toBeLessThanOrEqual(HARD_LIMITS.maxDailyTrades);
    expect(TUNABLE_BOUNDS.cooldownMinutes.min).toBeGreaterThanOrEqual(HARD_LIMITS.minCooldownMinutes);
  });

  it('clamps values into bounds', () => {
    expect(clampTunable('maxDailyLossPercent', 50)).toBe(HARD_LIMITS.maxDailyLossPercent);
    expect(clampTunable('maxDailyLossPercent', 0)).toBe(TUNABLE_BOUNDS.maxDailyLossPercent.min);
    expect(clampTunable('maxDailyLossPercent', 2)).toBe(2);
  });

  it('maps non-finite input to the lower bound', () => {
    expect(clampTunable('cooldownMinutes', Number.NaN)).toBe(TUNABLE_BOUNDS.cooldownMinutes.min);
  });

  it('recognises tunable keys', () => {
    expect(isTunableKey('maxDailyTrades')).toBe(true);
    expect(isTunableKey('liveTradingConfirmation')).toBe(false);
  });
});
