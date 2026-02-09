import { ObjectId } from 'mongodb';

export type Workflow = 'portfolio_manager' | 'scout' | 'sentinel';
export type Decision = 'HOLD' | 'BUY' | 'SELL' | 'TRIM' | 'ADD' | 'EXIT' | 'BLOCKED';

export interface MarketDataSnapshot {
  price: number;
  volume: number;
  changePercent: number;
  rsi?: number;
  vwap?: number;
}

export interface DecisionLog {
  _id?: ObjectId;
  symbol: string;
  workflow: Workflow;
  decision: Decision;
  executed: boolean;
  blockedReason: string | null;
  aiResponse: Record<string, unknown>;
  marketDataSnapshot: MarketDataSnapshot;
  createdAt: Date;
}
