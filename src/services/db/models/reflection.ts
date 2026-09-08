import { ObjectId } from 'mongodb';
import { PredictionVerdict } from './prediction';

export interface ReflectionItem {
  symbol: string;
  kind: 'prediction' | 'closed_trade';
  refId: string;
  verdict: PredictionVerdict;
  whatActuallyHappened: string;
  whatMattered: string;
  lesson: string;
}

export interface ParamSuggestion {
  key: string;
  value: number;
  rationale: string;
}

export interface ChangeRequestDraft {
  title: string;
  description: string;
  rationale: string;
  suggestedFiles: string[];
  priority: 'low' | 'medium' | 'high';
}

export interface Reflection {
  _id?: ObjectId;
  type: 'nightly' | 'weekly';
  date: string; // YYYY-MM-DD (ET)
  headline: string;
  summary: string;
  items: ReflectionItem[];
  patterns: string[];
  playbookSuggestions: Array<{ rule: string; evidence: string; confidence: 'low' | 'medium' | 'high' }>;
  paramSuggestions: ParamSuggestion[];
  /** Weekly only */
  changeRequests?: ChangeRequestDraft[];
  playbookVersionAfter: number | null;
  stats: Record<string, unknown>;
  modelUsed: string;
  createdAt: Date;
}

export interface Benchmark {
  _id?: ObjectId;
  date: string; // YYYY-MM-DD (ET)
  equity: number;
  spyClose: number | null;
  createdAt: Date;
}

export type ChangeRequestStatus =
  | 'proposed'
  | 'in_progress'
  | 'awaiting_approval'
  | 'merged'
  | 'deploying'
  | 'deployed'
  | 'rejected'
  | 'failed';

export interface ChangeRequest extends ChangeRequestDraft {
  _id?: ObjectId;
  status: ChangeRequestStatus;
  source: 'weekly_review' | 'manual';
  reflectionId: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  branch?: string;
  prUrl?: string;
  notes?: string[];
}
