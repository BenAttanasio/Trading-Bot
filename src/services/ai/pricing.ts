/**
 * Per-million-token list prices (USD) for the models the bot may run, used to
 * turn usage into dollars so AI spend can be judged against equity.
 * Cache reads are billed at 10% of input, cache writes at 125%.
 */
export interface ModelPrice {
  input: number;
  output: number;
}

const PRICES: Array<{ match: RegExp; price: ModelPrice }> = [
  { match: /^claude-haiku-4-5/, price: { input: 1, output: 5 } },
  { match: /^claude-sonnet-5/, price: { input: 2, output: 10 } },
  { match: /^claude-sonnet-4-6/, price: { input: 3, output: 15 } },
  { match: /^claude-opus-(5|4-[6-8])/, price: { input: 5, output: 25 } },
  { match: /^claude-(fable|mythos)-5/, price: { input: 10, output: 50 } },
];

const FALLBACK: ModelPrice = { input: 5, output: 25 };

export function priceFor(modelId: string): ModelPrice {
  return PRICES.find((p) => p.match.test(modelId))?.price ?? FALLBACK;
}

export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Pure: dollars for one response's usage on `modelId`. */
export function estimateCostUsd(modelId: string, u: UsageTokens): number {
  const p = priceFor(modelId);
  const perTok = 1 / 1_000_000;
  return (
    u.inputTokens * p.input * perTok +
    u.outputTokens * p.output * perTok +
    (u.cacheReadTokens ?? 0) * p.input * 0.1 * perTok +
    (u.cacheWriteTokens ?? 0) * p.input * 1.25 * perTok
  );
}

/** Haiku 4.5 and older models predate adaptive thinking / effort. */
export function supportsAdaptiveThinking(modelId: string): boolean {
  return !/^claude-(haiku-4-5|sonnet-4-5|opus-4-5|3)/.test(modelId);
}
