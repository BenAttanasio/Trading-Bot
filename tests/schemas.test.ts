import { describe, it, expect } from 'vitest';
import {
  NewTradeDecisionSchema,
  normalizeNewTradeDecision,
  normalizeMorningResearch,
  normalizeSentinelEvaluation,
  normalizeRanking,
  normalizePositionReview,
  SentinelEvaluationSchema,
  MorningResearchSchema,
  RankingSchema,
  PositionReviewSchema,
} from '../src/services/ai/schemas';

const validDecision = {
  action: 'BUY' as const,
  side: 'long' as const,
  conviction: 8,
  reasoning: 'Strong catalyst.',
  entryStrategy: 'market' as const,
  limitPrice: null,
  positionSize: 40,
  stopPrice: 95,
  targetPrice: 112,
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

  it('nulls non-positive stop/target prices and defaults side to long', () => {
    const out = normalizeNewTradeDecision({ ...validDecision, stopPrice: -1, targetPrice: Number.NaN, side: 'weird' as any }, 50);
    expect(out.stopPrice).toBeNull();
    expect(out.targetPrice).toBeNull();
    expect(out.side).toBe('long');
  });
});

describe('normalizeRanking', () => {
  const cand = (symbol: string, extra: Record<string, unknown> = {}) => ({
    symbol,
    side: 'long',
    score: 7,
    conviction: 7,
    confidence: 0.65,
    horizonDays: 10,
    expectedMovePct: 5,
    summary: 's',
    catalysts: [],
    risks: [],
    invalidationPrice: 95,
    targetPrice: 110,
    ...extra,
  });

  it('parses and clamps, dedupes symbols, and drops junk prices', () => {
    const parsed = RankingSchema.parse({
      marketRead: 'm',
      regime: 'mixed',
      candidates: [
        cand(' aapl ', { score: 14, conviction: 0, confidence: 2, horizonDays: 90 }),
        cand('AAPL'),
        cand('MSFT', { invalidationPrice: -5, targetPrice: 0 }),
      ],
    });
    const out = normalizeRanking(parsed);
    expect(out.candidates.map((c) => c.symbol)).toEqual(['AAPL', 'MSFT']);
    expect(out.candidates[0]).toMatchObject({ score: 10, conviction: 1, confidence: 1, horizonDays: 30 });
    expect(out.candidates[1].invalidationPrice).toBeNull();
    expect(out.candidates[1].targetPrice).toBeNull();
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

  it('keeps a positive newStopPrice on a position review and nulls a bad one', () => {
    const base = { action: 'HOLD', conviction: 6, reasoning: 'r', thesisUpdate: null, exitConditions: { profitTarget: '5%', stopLoss: '-3%' }, nextReviewIn: '1h' };
    expect(normalizePositionReview(PositionReviewSchema.parse({ ...base, newStopPrice: 97.5 })).newStopPrice).toBe(97.5);
    expect(normalizePositionReview(PositionReviewSchema.parse({ ...base, newStopPrice: 0 })).newStopPrice).toBeNull();
  });
});
