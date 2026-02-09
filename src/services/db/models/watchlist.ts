import { ObjectId } from 'mongodb';

export interface WatchlistItem {
  _id?: ObjectId;
  symbol: string;
  sector: string;
  reason: string;
  addedAt: Date;
  active: boolean;
}
