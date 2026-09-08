import { describe, it, expect, afterEach } from 'vitest';
import { TRADING_RULES, applyTunedParams, resetTunedParams, getDefaultRules } from '../src/config/trading-rules';
import { HARD_LIMITS } from '../src/config/hard-limits';

afterEach(() => resetTunedParams());

describe('applyTunedParams', () => {
  it('applies known keys, clamped to bounds', () => {
    const applied = applyTunedParams({ maxDailyLossPercent: 99, cooldownMinutes: 1 });
    expect(applied.maxDailyLossPercent).toBe(HARD_LIMITS.maxDailyLossPercent);
    expect(applied.cooldownMinutes).toBe(HARD_LIMITS.minCooldownMinutes);
    expect(TRADING_RULES.maxDailyLossPercent).toBe(HARD_LIMITS.maxDailyLossPercent);
  });

  it('ignores unknown keys and never touches non-tunable rules', () => {
    const before = TRADING_RULES.alpacaApiTimeoutMs;
    const applied = applyTunedParams({ alpacaApiTimeoutMs: 1, liveTradingConfirmation: 5, nonsense: 3 } as Record<string, unknown>);
    expect(Object.keys(applied)).toHaveLength(0);
    expect(TRADING_RULES.alpacaApiTimeoutMs).toBe(before);
  });

  it('reset restores env defaults', () => {
    applyTunedParams({ maxDailyTrades: 2 });
    expect(TRADING_RULES.maxDailyTrades).toBe(2);
    resetTunedParams();
    expect(TRADING_RULES.maxDailyTrades).toBe(getDefaultRules().maxDailyTrades);
  });
});
