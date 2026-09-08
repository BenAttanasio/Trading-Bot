import { ObjectId } from 'mongodb';

export type TradeAction = 'BUY' | 'SELL';
export type TradeTrigger = 'morning_research' | 'sentinel' | 'intraday_pulse' | 'eod' | 'manual' | 'portfolio_manager';
export type OrderStatus = 'pending' | 'submitted' | 'filled' | 'partially_filled' | 'cancelled' | 'rejected';
/** What the order means for the book; `action` stays the Alpaca side (BUY/SELL). */
export type TradeIntent = 'open_long' | 'close_long' | 'open_short' | 'close_short';

export interface Trade {
  _id?: ObjectId;
  symbol: string;
  action: TradeAction;
  intent?: TradeIntent;
  quantity: number;
  price: number;
  notional: number;
  orderId: string;
  orderStatus: OrderStatus;
  trigger: TradeTrigger;
  aiReasoning: string;
  aiConviction: number;
  riskChecks: {
    allPassed: boolean;
    details: Record<string, boolean>;
  };
  createdAt: Date;
  filledAt: Date | null;
}

export function createTrade(params: Omit<Trade, '_id' | 'createdAt' | 'filledAt'>): Trade {
  return {
    ...params,
    createdAt: new Date(),
    filledAt: null,
  };
}
