import { ObjectId } from 'mongodb';

export type PredictionDirection = 'up' | 'down' | 'flat';
export type PredictionVerdict = 'thesis_right' | 'thesis_wrong' | 'right_for_wrong_reason' | 'timing' | 'unclear';

export interface PredictionContext {
  news: Array<{ headline: string; date: string; source?: string }>;
  indicators: {
    rsi: number | null;
    sma20: number | null;
    volumeVsAvg: number | null;
    priceChange5d: number | null;
    priceChange1m: number | null;
  };
  available: string[];
  missing: string[];
  researchSummary?: string;
  catalystsCited?: string[];
  risksCited?: string[];
}

export interface PredictionOutcome {
  scoredAt: Date;
  priceAtDue: number;
  realizedMovePct: number;
  directionHit: boolean;
  /** Brier score of the direction call: (confidence - hit)^2, lower is better. */
  brier: number;
  maxFavorablePct: number | null;
  maxAdversePct: number | null;
  verdict?: PredictionVerdict;
  lesson?: string;
  reflectionId?: ObjectId;
}

/**
 * A falsifiable forecast recorded at decision time — for BUYs *and* PASSes — so
 * the reflection job can score calibration and spot missed opportunities.
 */
export interface Prediction {
  _id?: ObjectId;
  symbol: string;
  createdAt: Date;
  dueAt: Date;
  status: 'open' | 'scored';
  /** Did we actually trade on it? PASS decisions are recorded with acted=false. */
  acted: boolean;
  action: 'BUY' | 'PASS';
  trigger: string;
  orderId: string | null;
  entryPrice: number;
  direction: PredictionDirection;
  expectedMovePct: number;
  horizonDays: number;
  confidence: number;
  conviction: number;
  catalysts: string[];
  invalidation: string;
  thesis: string;
  modelUsed: string;
  context: PredictionContext;
  outcome?: PredictionOutcome;
}
