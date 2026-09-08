import { ObjectId } from 'mongodb';

export type ExitReason =
  | 'trailing_stop'
  | 'ai_exit'
  | 'ai_trim'
  | 'manual'
  /** Code-enforced (stop guard), no AI involved */
  | 'hard_stop'
  | 'target_hit'
  | 'time_stop';

export interface TradeOutcome {
  _id?: ObjectId;
  symbol: string;
  side?: 'long' | 'short';
  entryTrigger: string;
  entryPrice: number;
  exitPrice: number;
  entryDate: Date;
  exitDate: Date;
  daysHeld: number;
  realizedPLPercent: number;
  realizedPLDollars: number;
  aiConviction: number;
  originalThesis: string;
  exitReason: ExitReason;
  exitWorkflow: string;
  thesisFreshness: string;
  createdAt: Date;
}

/** Signed P&L % for a side: shorts profit when price falls. */
export function realizedPLPercentFor(side: 'long' | 'short', entryPrice: number, exitPrice: number): number {
  if (entryPrice <= 0) return 0;
  const raw = ((exitPrice - entryPrice) / entryPrice) * 100;
  return side === 'short' ? -raw : raw;
}
