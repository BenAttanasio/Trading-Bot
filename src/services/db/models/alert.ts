import { ObjectId } from 'mongodb';

export type AlertType = 'news' | 'price_spike' | 'volume_spike' | 'circuit_breaker';
export type AlertDirection = 'bullish' | 'bearish' | 'neutral';
export type AlertAction = 'triggered_deep_research' | 'queued_for_pulse' | 'ignored';

export interface Alert {
  _id?: ObjectId;
  type: AlertType;
  symbol: string;
  urgency: number;
  direction: AlertDirection;
  headline: string;
  aiSummary: string;
  actionTaken: AlertAction;
  resultingTradeId: ObjectId | null;
  createdAt: Date;
}
