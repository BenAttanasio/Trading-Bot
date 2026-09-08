import { describe, it, expect } from 'vitest';
import { estimateCostUsd, priceFor, supportsAdaptiveThinking } from '../src/services/ai/pricing';

describe('pricing', () => {
  it('prices Sonnet 5 and Haiku 4.5 at list', () => {
    expect(priceFor('claude-sonnet-5')).toEqual({ input: 2, output: 10 });
    expect(priceFor('claude-haiku-4-5')).toEqual({ input: 1, output: 5 });
    expect(priceFor('claude-opus-5')).toEqual({ input: 5, output: 25 });
  });

  it('bills cache reads at 10% and cache writes at 125% of input', () => {
    const usd = estimateCostUsd('claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 100_000 });
    expect(usd).toBeCloseTo(2 + 1 + 0.2 + 0.25, 6);
  });

  it('knows which models take adaptive thinking', () => {
    expect(supportsAdaptiveThinking('claude-sonnet-5')).toBe(true);
    expect(supportsAdaptiveThinking('claude-opus-5')).toBe(true);
    expect(supportsAdaptiveThinking('claude-haiku-4-5')).toBe(false);
  });
});
