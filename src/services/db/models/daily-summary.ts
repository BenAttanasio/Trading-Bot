import { ObjectId } from 'mongodb';

export interface DailySummary {
  _id?: ObjectId;
  date: string; // YYYY-MM-DD
  portfolioValue: number;
  cashBalance: number;
  investedValue: number;
  dailyPL: number;
  dailyPLPercent: number;
  totalPL: number;
  tradesExecuted: number;
  tradesBlocked: number;
  sentinelAlerts: number;
  topMover: { symbol: string; pl: number } | null;
  worstMover: { symbol: string; pl: number } | null;
  aiSummary: string;
  createdAt: Date;
}
