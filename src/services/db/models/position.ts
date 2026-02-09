import { ObjectId } from 'mongodb';

export type ThesisFreshness = 'fresh' | 'aging' | 'stale';

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
  entryTrigger: string;
  tags: string[];
  createdAt: Date;
  lastReviewedAt: Date;
}

export function calculateThesisFreshness(thesisLastUpdated: Date): ThesisFreshness {
  const daysSinceUpdate = (Date.now() - thesisLastUpdated.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceUpdate <= 1) return 'fresh';
  if (daysSinceUpdate <= 3) return 'aging';
  return 'stale';
}
