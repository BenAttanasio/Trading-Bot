import { TradeOutcome } from '../services/db/models/trade-outcome';

/**
 * The numbers a quant would ask for first. Pure functions over stored data.
 */

export interface GroupStats {
  n: number;
  winRate: number | null;
  avgPLPct: number | null;
  expectancyPct: number | null;
}

export interface TradeStats {
  n: number;
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  /** Mean realized % per trade — what one more trade is expected to return. */
  expectancyPct: number | null;
  /** Gross profit / gross loss in dollars; > 1 means the losers are paid for. */
  profitFactor: number | null;
  avgHoldDays: number | null;
  bestTradePct: number | null;
  worstTradePct: number | null;
  totalPLDollars: number;
  byTrigger: Record<string, GroupStats>;
  byExitReason: Record<string, GroupStats>;
  bySide: Record<string, GroupStats>;
}

function group(list: TradeOutcome[]): GroupStats {
  if (list.length === 0) return { n: 0, winRate: null, avgPLPct: null, expectancyPct: null };
  const wins = list.filter((o) => o.realizedPLPercent > 0).length;
  const avg = list.reduce((s, o) => s + o.realizedPLPercent, 0) / list.length;
  return { n: list.length, winRate: wins / list.length, avgPLPct: avg, expectancyPct: avg };
}

export function computeTradeStats(outcomes: TradeOutcome[]): TradeStats {
  const byKey = (key: (o: TradeOutcome) => string) => {
    const map: Record<string, TradeOutcome[]> = {};
    for (const o of outcomes) (map[key(o)] ??= []).push(o);
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, group(v)]));
  };

  if (outcomes.length === 0) {
    return {
      n: 0,
      winRate: null,
      avgWinPct: null,
      avgLossPct: null,
      expectancyPct: null,
      profitFactor: null,
      avgHoldDays: null,
      bestTradePct: null,
      worstTradePct: null,
      totalPLDollars: 0,
      byTrigger: {},
      byExitReason: {},
      bySide: {},
    };
  }

  const wins = outcomes.filter((o) => o.realizedPLPercent > 0);
  const losses = outcomes.filter((o) => o.realizedPLPercent <= 0);
  const grossProfit = wins.reduce((s, o) => s + Math.max(0, o.realizedPLDollars), 0);
  const grossLoss = losses.reduce((s, o) => s + Math.abs(Math.min(0, o.realizedPLDollars)), 0);
  const pcts = outcomes.map((o) => o.realizedPLPercent);

  return {
    n: outcomes.length,
    winRate: wins.length / outcomes.length,
    avgWinPct: wins.length ? wins.reduce((s, o) => s + o.realizedPLPercent, 0) / wins.length : null,
    avgLossPct: losses.length ? losses.reduce((s, o) => s + o.realizedPLPercent, 0) / losses.length : null,
    expectancyPct: pcts.reduce((s, v) => s + v, 0) / pcts.length,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    avgHoldDays: outcomes.reduce((s, o) => s + o.daysHeld, 0) / outcomes.length,
    bestTradePct: Math.max(...pcts),
    worstTradePct: Math.min(...pcts),
    totalPLDollars: outcomes.reduce((s, o) => s + o.realizedPLDollars, 0),
    byTrigger: byKey((o) => o.entryTrigger),
    byExitReason: byKey((o) => o.exitReason),
    bySide: byKey((o) => o.side ?? 'long'),
  };
}

export interface EquityPoint {
  date: string;
  equity: number;
}

export interface EquityStats {
  days: number;
  totalReturnPct: number | null;
  /** Annualized Sharpe from daily returns, risk-free 0. Null under 5 points. */
  sharpe: number | null;
  dailyVolPct: number | null;
  maxDrawdownPct: number | null;
  /** Compound annual growth rate implied by the window. */
  cagrPct: number | null;
}

export function computeEquityStats(points: EquityPoint[]): EquityStats {
  const series = [...points].filter((p) => p.equity > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (series.length < 2) return { days: series.length, totalReturnPct: null, sharpe: null, dailyVolPct: null, maxDrawdownPct: null, cagrPct: null };

  const rets: number[] = [];
  let peak = series[0].equity;
  let maxDD = 0;
  for (let i = 1; i < series.length; i++) {
    rets.push(series[i].equity / series[i - 1].equity - 1);
    peak = Math.max(peak, series[i].equity);
    maxDD = Math.max(maxDD, (peak - series[i].equity) / peak);
  }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.length > 1 ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1) : 0;
  const sd = Math.sqrt(variance);
  const totalReturn = series[series.length - 1].equity / series[0].equity - 1;
  const years = rets.length / 252;

  return {
    days: series.length,
    totalReturnPct: totalReturn * 100,
    sharpe: series.length >= 5 && sd > 0 ? (mean / sd) * Math.sqrt(252) : null,
    dailyVolPct: sd * 100,
    maxDrawdownPct: maxDD * 100,
    cagrPct: years > 0 && totalReturn > -1 ? (Math.pow(1 + totalReturn, 1 / years) - 1) * 100 : null,
  };
}

export interface AICostStats {
  todayUsd: number;
  last30dUsd: number;
  daysWithData: number;
  avgPerTradingDayUsd: number | null;
  annualizedUsd: number | null;
  /** Annualized AI spend as % of current equity — must be well under any plausible edge. */
  annualizedPctOfEquity: number | null;
}

export function computeAICostStats(params: {
  todayUsd: number;
  dailyCosts: Array<{ date: string; aiCostUsd?: number | null }>;
  equity: number;
}): AICostStats {
  const withData = params.dailyCosts.filter((d) => typeof d.aiCostUsd === 'number' && Number.isFinite(d.aiCostUsd));
  const last30 = withData.slice(0, 30);
  const last30dUsd = last30.reduce((s, d) => s + (d.aiCostUsd ?? 0), 0);
  const avg = last30.length ? last30dUsd / last30.length : params.todayUsd > 0 ? params.todayUsd : null;
  const annualized = avg == null ? null : avg * 252;
  return {
    todayUsd: params.todayUsd,
    last30dUsd,
    daysWithData: last30.length,
    avgPerTradingDayUsd: avg,
    annualizedUsd: annualized,
    annualizedPctOfEquity: annualized != null && params.equity > 0 ? (annualized / params.equity) * 100 : null,
  };
}
