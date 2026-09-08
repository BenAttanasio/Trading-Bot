import { ObjectId } from 'mongodb';

export interface Research {
  _id?: ObjectId;
  symbol: string;
  type: 'morning_research' | 'deep_dive' | 'sentinel_escalation' | 'ranking';
  /** Ranking output only */
  side?: 'long' | 'short' | 'none';
  score?: number;
  summary: string;
  fullAnalysis: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  conviction: number;
  catalysts: string[];
  risks: string[];
  priceTarget: string | null;
  recommendation: 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
  modelUsed: string;
  createdAt: Date;
}
