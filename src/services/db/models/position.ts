import { ObjectId } from 'mongodb';

export type ThesisFreshness = 'fresh' | 'aging' | 'stale';
export type PositionSide = 'long' | 'short';

export interface ExitConditions {
  profitTarget: string;
  stopLoss: string;
}

export interface TrailingStop {
  activatedAt: string;
  floor: string;
}

export interface Position {
  _id?: ObjectId;
  symbol: string;
  /** Defaults to long for records written before shorts existed. */
  side?: PositionSide;
  sector?: string;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  unrealizedPL: number;
  unrealizedPLPercent: number;
  daysHeld: number;
  thesis: string;
  thesisLastUpdated: Date;
  thesisFreshness: ThesisFreshness;
  exitConditions: ExitConditions;
  trailingStop: TrailingStop | null;
  /** Code-enforced exits (stop guard). Null = not set (legacy). */
  stopPrice?: number | null;
  targetPrice?: number | null;
  timeStopAt?: Date | null;
  atrAtEntry?: number | null;
  horizonDays?: number | null;
  entryTrigger: string;
  tags: string[];
  createdAt: Date;
  lastReviewedAt: Date;
}

export function positionSide(p: Pick<Position, 'side'> | null | undefined): PositionSide {
  return p?.side === 'short' ? 'short' : 'long';
}

export function calculateThesisFreshness(thesisLastUpdated: Date): ThesisFreshness {
  const daysSinceUpdate = (Date.now() - thesisLastUpdated.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceUpdate <= 1) return 'fresh';
  if (daysSinceUpdate <= 3) return 'aging';
  return 'stale';
}
