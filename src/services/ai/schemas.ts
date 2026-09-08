import * as z from 'zod/v4';

/**
 * Structured-output schemas for every AI call, plus normalizers that clamp
 * numeric ranges (structured outputs guarantee shape, not ranges).
 *
 * Rules for these schemas: no .optional() (use .nullable()), no numeric
 * min/max constraints (not supported by structured outputs) — clamp instead.
 */

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

// ─── Sentinel ────────────────────────────────────────────

export const SentinelEvaluationSchema = z.object({
  urgency: z.number().describe('1-10 integer, 10 = act immediately'),
  direction: z.enum(['bullish', 'bearish', 'neutral']),
  summary: z.string().describe('1-2 sentence impact assessment'),
  suggestedAction: z.enum(['escalate', 'queue', 'ignore']),
  reasoning: z.string().describe('brief reasoning'),
});
export type SentinelEvaluation = z.infer<typeof SentinelEvaluationSchema>;

export function normalizeSentinelEvaluation(d: SentinelEvaluation): SentinelEvaluation {
  return { ...d, urgency: Math.round(clamp(d.urgency, 1, 10)) };
}

// ─── Morning research ────────────────────────────────────

export const MorningResearchSchema = z.object({
  symbol: z.string(),
  sentiment: z.enum(['bullish', 'bearish', 'neutral']),
  conviction: z.number().describe('1-10'),
  summary: z.string().describe('2-3 sentence summary'),
  catalysts: z.array(z.string()),
  risks: z.array(z.string()),
  technicalOutlook: z.string().describe('1-2 sentences, or note that data was unavailable'),
  fundamentalOutlook: z.string().describe('1-2 sentences'),
  recommendation: z.enum(['BUY', 'SELL', 'HOLD', 'WATCH']),
  priceTarget: z.string().nullable().describe('target price, or null'),
  stopLoss: z.string().nullable().describe('stop-loss price, or null'),
  timeHorizon: z.string().describe("e.g. '1-2 weeks'"),
  positionSizeRecommendation: z
    .number()
    .describe('dollar amount; must not exceed the max position size in the rules'),
});
export type MorningResearchResult = z.infer<typeof MorningResearchSchema>;

export function normalizeMorningResearch(d: MorningResearchResult, maxPosition: number): MorningResearchResult {
  return {
    ...d,
    conviction: Math.round(clamp(d.conviction, 1, 10)),
    positionSizeRecommendation: clamp(d.positionSizeRecommendation, 0, maxPosition),
  };
}

// ─── Cross-sectional ranking (one call for the whole candidate set) ──────────

export const RankingCandidateSchema = z.object({
  symbol: z.string(),
  side: z.enum(['long', 'short', 'none']).describe('the side with edge, or none'),
  score: z.number().describe('-10 (strongest short) to +10 (strongest long); 0 = no edge'),
  conviction: z.number().describe('1-10 conviction in the side call'),
  confidence: z.number().describe('0-1 probability the side call is right over the horizon'),
  horizonDays: z.number().describe('trading days for the thesis to play out (1-30)'),
  expectedMovePct: z.number().describe('signed expected % move over the horizon'),
  summary: z.string().describe('1-2 sentences: the thesis, or why there is no edge'),
  catalysts: z.array(z.string()).describe('dated, concrete; empty if none'),
  risks: z.array(z.string()),
  invalidationPrice: z.number().nullable().describe('price at which the thesis is wrong (the stop), or null'),
  targetPrice: z.number().nullable(),
});
export type RankingCandidate = z.infer<typeof RankingCandidateSchema>;

export const RankingSchema = z.object({
  marketRead: z.string().describe('2-3 sentences on the tape and which setups should work today'),
  regime: z.enum(['risk_on', 'risk_off', 'mixed']),
  candidates: z.array(RankingCandidateSchema).describe('one entry per candidate symbol — include every symbol given'),
});
export type RankingResult = z.infer<typeof RankingSchema>;

export function normalizeRanking(d: RankingResult): RankingResult {
  const seen = new Set<string>();
  const candidates: RankingCandidate[] = [];
  for (const c of d.candidates) {
    const symbol = c.symbol.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    candidates.push({
      ...c,
      symbol,
      score: clamp(c.score, -10, 10),
      conviction: Math.round(clamp(c.conviction, 1, 10)),
      confidence: clamp(c.confidence, 0, 1),
      horizonDays: Math.max(1, Math.round(clamp(c.horizonDays, 1, 30))),
      invalidationPrice: c.invalidationPrice != null && Number.isFinite(c.invalidationPrice) && c.invalidationPrice > 0 ? c.invalidationPrice : null,
      targetPrice: c.targetPrice != null && Number.isFinite(c.targetPrice) && c.targetPrice > 0 ? c.targetPrice : null,
    });
  }
  return { ...d, candidates };
}

// ─── Position review ─────────────────────────────────────

export const ExitConditionsSchema = z.object({
  profitTarget: z.string().describe('$ or %'),
  stopLoss: z.string().describe('$ or %'),
});

export const PositionReviewSchema = z.object({
  action: z.enum(['HOLD', 'TRIM', 'EXIT', 'ADD']),
  conviction: z.number().describe('1-10'),
  reasoning: z.string().describe('2-3 sentence explanation'),
  thesisUpdate: z.string().nullable().describe('updated thesis if it changed, else null'),
  exitConditions: ExitConditionsSchema,
  newStopPrice: z
    .number()
    .nullable()
    .describe('a TIGHTER stop to apply now (closer to the current price than the existing one), or null to keep it; loosening is ignored'),
  nextReviewIn: z.enum(['30m', '1h', '4h', 'next_pulse']),
});
export type PositionReviewResult = z.infer<typeof PositionReviewSchema>;

export function normalizePositionReview(d: PositionReviewResult): PositionReviewResult {
  return {
    ...d,
    conviction: Math.round(clamp(d.conviction, 1, 10)),
    newStopPrice: d.newStopPrice != null && Number.isFinite(d.newStopPrice) && d.newStopPrice > 0 ? d.newStopPrice : null,
  };
}

// ─── New trade decision (+ prediction, scored later by the reflection job) ──

export const PredictionSchema = z.object({
  direction: z.enum(['up', 'down', 'flat']).describe('expected price direction over the horizon'),
  expectedMovePct: z.number().describe('expected % move over the horizon, signed'),
  horizonDays: z.number().describe('trading days until this prediction should be judged'),
  catalysts: z.array(z.string()).describe('specific events or news the thesis depends on'),
  invalidation: z.string().describe('what observation would prove the thesis wrong'),
  confidence: z.number().describe('0-1 probability the direction call is right'),
});
export type Prediction = z.infer<typeof PredictionSchema>;

export const NewTradeDecisionSchema = z.object({
  action: z.enum(['BUY', 'PASS']).describe('BUY = enter on the given side (long or short); PASS = do nothing'),
  side: z.enum(['long', 'short']).describe('the side being evaluated; echo it back'),
  conviction: z.number().describe('1-10'),
  reasoning: z.string().describe('2-3 sentence explanation'),
  entryStrategy: z.enum(['market', 'limit']),
  limitPrice: z.number().nullable(),
  positionSize: z.number().describe('dollar amount; advisory — code sizes by risk and may shrink it'),
  stopPrice: z.number().nullable().describe('price where the thesis is wrong: below entry for long, above for short. Enforced in code.'),
  targetPrice: z.number().nullable().describe('profit target price on the winning side. Enforced in code.'),
  thesis: z.string().describe('investment thesis in one paragraph'),
  exitConditions: ExitConditionsSchema,
  timeHorizon: z.string().describe("e.g. '1-2 weeks'"),
  prediction: PredictionSchema,
});
export type NewTradeDecisionResult = z.infer<typeof NewTradeDecisionSchema>;

export function normalizeNewTradeDecision(d: NewTradeDecisionResult, maxPosition: number): NewTradeDecisionResult {
  const num = (v: number | null | undefined) => (v != null && Number.isFinite(v) && v > 0 ? v : null);
  return {
    ...d,
    side: d.side === 'short' ? 'short' : 'long',
    conviction: Math.round(clamp(d.conviction, 1, 10)),
    positionSize: clamp(d.positionSize, 0, maxPosition),
    stopPrice: num(d.stopPrice),
    targetPrice: num(d.targetPrice),
    prediction: {
      ...d.prediction,
      horizonDays: Math.max(1, Math.round(clamp(d.prediction.horizonDays, 1, 60))),
      confidence: clamp(d.prediction.confidence, 0, 1),
    },
  };
}

// ─── Intraday pulse ──────────────────────────────────────

export const IntradayPulseSchema = z.object({
  overallAssessment: z.string(),
  positionActions: z.array(
    z.object({
      symbol: z.string(),
      action: z.enum(['HOLD', 'TRIM', 'EXIT', 'ADD']),
      urgency: z.enum(['none', 'low', 'high']),
      reasoning: z.string(),
    })
  ),
  alertActions: z.array(
    z.object({
      symbol: z.string(),
      action: z.enum(['research_now', 'watch', 'ignore']),
      reasoning: z.string(),
    })
  ),
  newOpportunities: z.array(z.string()),
});
export type IntradayPulseResult = z.infer<typeof IntradayPulseSchema>;

// ─── EOD summary ─────────────────────────────────────────

export const EodSummarySchema = z.object({
  summary: z.string().describe('3-5 sentence recap of the day'),
  keyDecisions: z.array(z.string()),
  lessonsLearned: z.array(z.string()),
  watchTomorrow: z.array(z.string()),
  riskAssessment: z.string().describe('1-2 sentences on current risk posture'),
  confidenceLevel: z.number().describe('1-10 confidence in current positions'),
});
export type EodSummaryResult = z.infer<typeof EodSummarySchema>;

export function normalizeEodSummary(d: EodSummaryResult): EodSummaryResult {
  return { ...d, confidenceLevel: Math.round(clamp(d.confidenceLevel, 1, 10)) };
}

// ─── Reflection (nightly post-mortem) ────────────────────

export const VerdictEnum = z.enum(['thesis_right', 'thesis_wrong', 'right_for_wrong_reason', 'timing', 'unclear']);

export const NightlyReflectionSchema = z.object({
  headline: z.string().describe('one line, <= 90 chars: the day in a sentence'),
  summary: z.string().describe('3-6 sentences, specific, no filler'),
  items: z.array(
    z.object({
      symbol: z.string(),
      kind: z.enum(['prediction', 'closed_trade']),
      refId: z.string().describe('copy the id exactly as given'),
      verdict: VerdictEnum,
      whatActuallyHappened: z.string(),
      whatMattered: z.string().describe('which cited news/catalyst/indicator actually drove the outcome, or what we missed'),
      lesson: z.string().describe('one sentence, generalizable, or "none"'),
    })
  ),
  patterns: z.array(z.string()).describe('cross-item patterns, empty if none'),
  playbookSuggestions: z.array(
    z.object({
      rule: z.string(),
      evidence: z.string(),
      confidence: z.enum(['low', 'medium', 'high']),
    })
  ),
  paramSuggestions: z.array(
    z.object({
      key: z.string().describe('one of the tunable keys'),
      value: z.number(),
      rationale: z.string(),
    })
  ),
  lessonsToAppend: z
    .array(z.string())
    .describe('0-3 crisp, generalizable lessons worth adding to the playbook tonight; empty if nothing new'),
});
export type NightlyReflectionResult = z.infer<typeof NightlyReflectionSchema>;

// ─── Weekly deep review ──────────────────────────────────

export const WeeklyReviewSchema = z.object({
  headline: z.string().describe('one line, <= 90 chars'),
  assessment: z.string().describe('the week in 4-8 sentences: what worked, what did not, why'),
  performanceVsBenchmark: z.string(),
  calibrationNotes: z.string().describe('are stated confidences honest? where over/under-confident?'),
  newStrategyMd: z
    .string()
    .describe('the COMPLETE revised playbook markdown (<= 4000 chars). Keep the section headings. Consolidate "Recent lessons" into rules or discard them. Keep "Known mistakes" honest.'),
  paramChanges: z.array(
    z.object({
      key: z.string().describe('one of the tunable keys'),
      value: z.number(),
      rationale: z.string(),
    })
  ),
  changeRequests: z.array(
    z.object({
      title: z.string(),
      description: z.string().describe('what to build/change, concretely'),
      rationale: z.string().describe('the evidence from this week that motivates it'),
      suggestedFiles: z.array(z.string()),
      priority: z.enum(['low', 'medium', 'high']),
    })
  ).describe('code-level changes the playbook cannot express; empty most weeks'),
  experimentsNextWeek: z.array(z.string()),
  confidence: z.number().describe('0-1 confidence in this assessment'),
});
export type WeeklyReviewResult = z.infer<typeof WeeklyReviewSchema>;
