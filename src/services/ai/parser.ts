import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('AIParser');

// ─── Response Types ──────────────────────────────────────

export interface SentinelEvaluation {
  urgency: number;
  direction: 'bullish' | 'bearish' | 'neutral';
  summary: string;
  suggestedAction: 'escalate' | 'queue' | 'ignore';
  reasoning: string;
}

export interface MorningResearchResult {
  symbol: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  conviction: number;
  summary: string;
  catalysts: string[];
  risks: string[];
  technicalOutlook: string;
  fundamentalOutlook: string;
  recommendation: 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
  priceTarget: string | null;
  stopLoss: string | null;
  timeHorizon: string;
  positionSizeRecommendation: number;
}

export interface PositionReviewResult {
  action: 'HOLD' | 'TRIM' | 'EXIT' | 'ADD';
  conviction: number;
  reasoning: string;
  thesisUpdate: string | null;
  exitConditions: {
    profitTarget: string;
    stopLoss: string;
  };
  nextReviewIn: string;
}

export interface NewTradeDecisionResult {
  action: 'BUY' | 'PASS';
  conviction: number;
  reasoning: string;
  entryStrategy: 'market' | 'limit';
  limitPrice: number | null;
  positionSize: number;
  thesis: string;
  exitConditions: {
    profitTarget: string;
    stopLoss: string;
  };
  timeHorizon: string;
}

export interface IntradayPulseResult {
  overallAssessment: string;
  positionActions: Array<{
    symbol: string;
    action: 'HOLD' | 'TRIM' | 'EXIT' | 'ADD';
    urgency: 'none' | 'low' | 'high';
    reasoning: string;
  }>;
  alertActions: Array<{
    symbol: string;
    action: 'research_now' | 'watch' | 'ignore';
    reasoning: string;
  }>;
  newOpportunities: string[];
}

export interface EodSummaryResult {
  summary: string;
  keyDecisions: string[];
  lessonsLearned: string[];
  watchTomorrow: string[];
  riskAssessment: string;
  confidenceLevel: number;
}

// ─── Validation Helpers ──────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function validateEnum<T extends string>(value: string, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

// ─── Parsers with Fallback ───────────────────────────────

export function parseSentinelEvaluation(data: Record<string, unknown>): SentinelEvaluation {
  return {
    urgency: clamp(Number(data.urgency) || 1, 1, 10),
    direction: validateEnum(String(data.direction || 'neutral'), ['bullish', 'bearish', 'neutral'], 'neutral'),
    summary: String(data.summary || 'Unable to evaluate'),
    suggestedAction: validateEnum(String(data.suggestedAction || 'ignore'), ['escalate', 'queue', 'ignore'], 'ignore'),
    reasoning: String(data.reasoning || ''),
  };
}

export function parseMorningResearch(data: Record<string, unknown>): MorningResearchResult {
  return {
    symbol: String(data.symbol || ''),
    sentiment: validateEnum(String(data.sentiment || 'neutral'), ['bullish', 'bearish', 'neutral'], 'neutral'),
    conviction: clamp(Number(data.conviction) || 5, 1, 10),
    summary: String(data.summary || ''),
    catalysts: Array.isArray(data.catalysts) ? data.catalysts.map(String) : [],
    risks: Array.isArray(data.risks) ? data.risks.map(String) : [],
    technicalOutlook: String(data.technicalOutlook || ''),
    fundamentalOutlook: String(data.fundamentalOutlook || ''),
    recommendation: validateEnum(String(data.recommendation || 'HOLD'), ['BUY', 'SELL', 'HOLD', 'WATCH'], 'HOLD'),
    priceTarget: data.priceTarget ? String(data.priceTarget) : null,
    stopLoss: data.stopLoss ? String(data.stopLoss) : null,
    timeHorizon: String(data.timeHorizon || '1-2 weeks'),
    positionSizeRecommendation: clamp(Number(data.positionSizeRecommendation) || 25, 0, 50),
  };
}

export function parsePositionReview(data: Record<string, unknown>): PositionReviewResult {
  const exitConditions = (data.exitConditions || {}) as Record<string, unknown>;
  return {
    action: validateEnum(String(data.action || 'HOLD'), ['HOLD', 'TRIM', 'EXIT', 'ADD'], 'HOLD'),
    conviction: clamp(Number(data.conviction) || 5, 1, 10),
    reasoning: String(data.reasoning || ''),
    thesisUpdate: data.thesisUpdate ? String(data.thesisUpdate) : null,
    exitConditions: {
      profitTarget: String(exitConditions.profitTarget || '5%'),
      stopLoss: String(exitConditions.stopLoss || '-3%'),
    },
    nextReviewIn: String(data.nextReviewIn || 'next_pulse'),
  };
}

export function parseNewTradeDecision(data: Record<string, unknown>): NewTradeDecisionResult {
  const exitConditions = (data.exitConditions || {}) as Record<string, unknown>;
  return {
    action: validateEnum(String(data.action || 'PASS'), ['BUY', 'PASS'], 'PASS'),
    conviction: clamp(Number(data.conviction) || 5, 1, 10),
    reasoning: String(data.reasoning || ''),
    entryStrategy: validateEnum(String(data.entryStrategy || 'market'), ['market', 'limit'], 'market'),
    limitPrice: data.limitPrice ? Number(data.limitPrice) : null,
    positionSize: clamp(Number(data.positionSize) || 25, 0, 50),
    thesis: String(data.thesis || ''),
    exitConditions: {
      profitTarget: String(exitConditions.profitTarget || '5%'),
      stopLoss: String(exitConditions.stopLoss || '-3%'),
    },
    timeHorizon: String(data.timeHorizon || '1-2 weeks'),
  };
}

export function parseIntradayPulse(data: Record<string, unknown>): IntradayPulseResult {
  return {
    overallAssessment: String(data.overallAssessment || ''),
    positionActions: Array.isArray(data.positionActions)
      ? data.positionActions.map((a: any) => ({
          symbol: String(a.symbol || ''),
          action: validateEnum(String(a.action || 'HOLD'), ['HOLD', 'TRIM', 'EXIT', 'ADD'], 'HOLD'),
          urgency: validateEnum(String(a.urgency || 'none'), ['none', 'low', 'high'], 'none'),
          reasoning: String(a.reasoning || ''),
        }))
      : [],
    alertActions: Array.isArray(data.alertActions)
      ? data.alertActions.map((a: any) => ({
          symbol: String(a.symbol || ''),
          action: validateEnum(String(a.action || 'ignore'), ['research_now', 'watch', 'ignore'], 'ignore'),
          reasoning: String(a.reasoning || ''),
        }))
      : [],
    newOpportunities: Array.isArray(data.newOpportunities)
      ? data.newOpportunities.map(String)
      : [],
  };
}

export function parseEodSummary(data: Record<string, unknown>): EodSummaryResult {
  return {
    summary: String(data.summary || ''),
    keyDecisions: Array.isArray(data.keyDecisions) ? data.keyDecisions.map(String) : [],
    lessonsLearned: Array.isArray(data.lessonsLearned) ? data.lessonsLearned.map(String) : [],
    watchTomorrow: Array.isArray(data.watchTomorrow) ? data.watchTomorrow.map(String) : [],
    riskAssessment: String(data.riskAssessment || ''),
    confidenceLevel: clamp(Number(data.confidenceLevel) || 5, 1, 10),
  };
}
