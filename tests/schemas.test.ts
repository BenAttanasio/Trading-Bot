import { describe, it, expect } from 'vitest';
import {
  NewTradeDecisionSchema,
  normalizeNewTradeDecision,
  normalizeMorningResearch,
  normalizeSentinelEvaluation,
  SentinelEvaluationSchema,
  MorningResearchSchema,
} from '../src/services/ai/schemas';

const validDecision = {
  action: 'BUY' as const,
  conviction: 8,
  reasoning: 'Strong catalyst.',
  entryStrategy: 'market' as const,
  limitPrice: null,
  positionSize: 40,
  thesis: 'Earnings beat drives re-rating.',
  exitConditions: { profitTarget: '8%', stopLoss: '-4%' },
  timeHorizon: '1-2 weeks',
  prediction: {
    direction: 'up' as const,
    expectedMovePct: 6,
    horizonDays: 10,
    catalysts: ['earnings'],
    invalidation: 'Close below $100',
    confidence: 0.7,
  },
};

describe('NewTradeDecisionSchema', () => {
  it('accepts a well-formed decision', () => {
    expect(NewTradeDecisionSchema.safeParse(validDecision).success).toBe(true);
  });

  it('rejects an unknown action', () => {
    const bad = { ...validDecision, action: 'SHORT' };
    expect(NewTradeDecisionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing prediction', () => {
    const { prediction: _p, ...bad } = validDecision;
    expect(NewTradeDecisionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('normalizeNewTradeDecision', () => {
  it('clamps position size to the max and conviction to 1-10', () => {
    const out = normalizeNewTradeDecision({ ...validDecision, positionSize: 999, conviction: 14 }, 50);
    expect(out.positionSize).toBe(50);
    expect(out.conviction).toBe(10);
  });

  it('clamps prediction confidence into [0,1] and horizon to >= 1 day', () => {
    const out = normalizeNewTradeDecision(
      { ...validDecision, prediction: { ...validDecision.prediction, confidence: 1.4, horizonDays: 0 } },
      50
    );
    expect(out.prediction.confidence).toBe(1);
    expect(out.prediction.horizonDays).toBe(1);
  });

  it('turns non-finite numbers into the lower bound instead of NaN', () => {
    const out = normalizeNewTradeDecision({ ...validDecision, positionSize: Number.NaN }, 50);
    expect(out.positionSize).toBe(0);
  });
});

describe('other normalizers', () => {
  it('rounds sentinel urgency into 1-10', () => {
    const parsed = SentinelEvaluationSchema.parse({
      urgency: 11.6,
      direction: 'bullish',
      summary: 's',
      suggestedAction: 'escalate',
      reasoning: 'r',
    });
    expect(normalizeSentinelEvaluation(parsed).urgency).toBe(10);
  });

  it('clamps research position size to the configured max', () => {
    const parsed = MorningResearchSchema.parse({
      symbol: 'AAPL',
      sentiment: 'bullish',
      conviction: 7,
      summary: 's',
      catalysts: [],
      risks: [],
      technicalOutlook: 't',
      fundamentalOutlook: 'f',
      recommendation: 'BUY',
      priceTarget: null,
      stopLoss: null,
      timeHorizon: '1w',
      positionSizeRecommendation: 500,
    });
    expect(normalizeMorningResearch(parsed, 50).positionSizeRecommendation).toBe(50);
  });
});
