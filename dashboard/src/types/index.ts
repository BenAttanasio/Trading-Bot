export interface DashboardData {
  status: {
    botRunning: boolean;
    tradingPaused: boolean;
    marketState: string;
    lastHeartbeat: string;
    nextPulse: {
      time: string;
      label: string;
    };
    botMood: {
      label: string;
      description: string;
      colorKey: 'gray' | 'red' | 'orange' | 'blue' | 'green';
    };
    tokenUsage: {
      total: number;
      budget: number;
      byModel: { budget: number; fast: number; deep: number };
    };
  };
  portfolio: {
    value: number;
    cash: number;
    invested: number;
    dailyPL: number;
    dailyPLPercent: number;
    positionCount: number;
  };
  positions: PositionData[];
  recentTrades: TradeData[];
  recentAlerts: AlertData[];
  dailySummaries: DailySummaryData[];
  todayStats: {
    tradesExecuted: number;
    tradesBlocked: number;
    alertsToday: number;
  };
}

export interface PositionData {
  symbol: string;
  qty: number;
  entryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPL: number;
  unrealizedPLPercent: number;
  thesis: string | null;
  thesisFreshness: string | null;
  daysHeld: number;
}

export interface TradeData {
  symbol: string;
  action: string;
  notional: number;
  price: number;
  trigger: string;
  aiReasoning: string;
  aiConviction: number;
  orderStatus: string;
  createdAt: string;
}

export interface AlertData {
  type: string;
  symbol: string;
  urgency: number;
  direction: string;
  headline: string;
  actionTaken: string;
  createdAt: string;
}

export interface DailySummaryData {
  date: string;
  portfolioValue: number;
  investedValue: number;
  dailyPL: number;
  dailyPLPercent: number;
  tradesExecuted: number;
  aiSummary: string;
}

export interface LiveDataPoint {
  time: string;
  value: number;
}

export interface WatchlistItem {
  symbol: string;
  sector: string;
  reason: string;
  addedAt: string;
  active: boolean;
}

export interface ConfigData {
  rules: Record<string, number>;
  tradingPaused: boolean;
}

export interface ActivityEvent {
  id: number;
  timestamp: string;
  service: string;
  level: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface TradeOutcome {
  symbol: string;
  entryTrigger: string;
  entryPrice: number;
  exitPrice: number;
  entryDate: string;
  exitDate: string;
  daysHeld: number;
  realizedPLPercent: number;
  realizedPLDollars: number;
  aiConviction: number;
  originalThesis: string;
  exitReason: string;
  exitWorkflow: string;
  thesisFreshness: string;
  createdAt: string;
}

export interface TriggerStats {
  count: number;
  winRate: number;
  avgPL: number;
}

export interface ConvictionStats {
  range: string;
  count: number;
  winRate: number;
}

export interface OutcomesData {
  outcomes: TradeOutcome[];
  stats: {
    totalTrades: number;
    winRate: number;
    avgPLPercent: number;
    avgDaysHeld: number;
    byTrigger: Record<string, TriggerStats>;
    byConviction: {
      high: ConvictionStats;
      mid: ConvictionStats;
      low: ConvictionStats;
    };
  };
}
