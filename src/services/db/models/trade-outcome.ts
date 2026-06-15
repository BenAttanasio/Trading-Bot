import { ObjectId } from 'mongodb';

export type ExitReason = 'trailing_stop' | 'ai_exit' | 'ai_trim' | 'manual';

export interface TradeOutcome {
  _id?: ObjectId;
  symbol: string;
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
