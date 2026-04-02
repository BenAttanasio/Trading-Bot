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
  dailyPL: number;
  dailyPLPercent: number;
  tradesExecuted: number;
  aiSummary: string;
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
