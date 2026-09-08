/**
 * Volatility-scaled position sizing. Pure functions; no I/O.
 *
 * size = (equity × risk% × calibration multiplier) / stop distance, capped by the
 * configured max position and the hard % of equity ceiling. The stop is the
 * decision's invalidation price when it is sane, otherwise an ATR multiple.
 */

export type Side = 'long' | 'short';

export interface StopResolution {
  stopPrice: number;
  stopDistancePct: number;
  source: 'decision' | 'atr' | 'fallback';
}

export interface ResolveStopInput {
  price: number;
  side: Side;
  proposedStop: number | null | undefined;
  atr: number | null | undefined;
  atrMultiple: number;
  /** Widest stop we accept, % of price (default 15). */
  maxStopPct?: number;
  /** Tightest stop we accept, % of price (default 0.5). */
  minStopPct?: number;
}

function isOnStopSide(side: Side, stop: number, price: number): boolean {
  return side === 'long' ? stop > 0 && stop < price : stop > price;
}

export function resolveStop(input: ResolveStopInput): StopResolution {
  const { price, side } = input;
  const maxStopPct = input.maxStopPct ?? 15;
  const minStopPct = input.minStopPct ?? 0.5;
  const distPct = (stop: number) => (Math.abs(price - stop) / price) * 100;

  const proposed = input.proposedStop;
  if (proposed != null && Number.isFinite(proposed) && price > 0 && isOnStopSide(side, proposed, price)) {
    const d = distPct(proposed);
    if (d >= minStopPct && d <= maxStopPct) {
      return { stopPrice: round2(proposed), stopDistancePct: d, source: 'decision' };
    }
  }

  const atr = input.atr;
  if (atr != null && Number.isFinite(atr) && atr > 0 && price > 0) {
    let distance = atr * input.atrMultiple;
    distance = Math.min(distance, price * (maxStopPct / 100));
    distance = Math.max(distance, price * (minStopPct / 100));
    const stop = side === 'long' ? price - distance : price + distance;
    return { stopPrice: round2(stop), stopDistancePct: (distance / price) * 100, source: 'atr' };
  }

  const fallbackPct = 5;
  const stop = side === 'long' ? price * (1 - fallbackPct / 100) : price * (1 + fallbackPct / 100);
  return { stopPrice: round2(stop), stopDistancePct: fallbackPct, source: 'fallback' };
}

/** Target on the profit side; falls back to rewardRatio × stop distance. */
export function resolveTarget(
  price: number,
  side: Side,
  proposedTarget: number | null | undefined,
  stopDistancePct: number,
  rewardRatio = 2
): number {
  if (proposedTarget != null && Number.isFinite(proposedTarget)) {
    const ok = side === 'long' ? proposedTarget > price : proposedTarget > 0 && proposedTarget < price;
    if (ok) return round2(proposedTarget);
  }
  const distance = price * (stopDistancePct / 100) * rewardRatio;
  return round2(side === 'long' ? price + distance : Math.max(0.01, price - distance));
}

export interface CalibrationSummary {
  n: number;
  hitRate: number | null;
}

/**
 * Calibration-driven scale on the risk budget. Below `minScored` samples we
 * have no evidence either way, so the multiplier is 1. A 55% directional hit
 * rate is treated as par; every point above/below moves the budget by 5%,
 * bounded to [0.25, 1.5]. Fractional-Kelly in spirit, deliberately timid.
 */
export function calibrationMultiplier(cal: CalibrationSummary | null | undefined, minScored: number): number {
  if (!cal || cal.hitRate == null || cal.n < minScored) return 1;
  const m = 1 + (cal.hitRate - 0.55) * 5;
  return Math.max(0.25, Math.min(1.5, m));
}

export interface SizeInput {
  equity: number;
  price: number;
  side: Side;
  stopDistancePct: number;
  riskPerTradePercent: number;
  maxPositionDollars: number;
  /** HARD_LIMITS.maxPositionPercentOfEquity */
  hardMaxPositionPct: number;
  calibration?: CalibrationSummary | null;
  minScoredForCalibration: number;
  /** Shorts and some assets need whole shares. */
  wholeShares: boolean;
}

export interface SizeResult {
  notional: number;
  qty: number;
  riskDollars: number;
  multiplier: number;
  cappedBy: 'risk' | 'maxPosition' | 'hardLimit' | 'lot' | 'none';
  reason: string;
}

export function sizePosition(input: SizeInput): SizeResult {
  const multiplier = calibrationMultiplier(input.calibration, input.minScoredForCalibration);
  const riskDollars = Math.max(0, input.equity * (input.riskPerTradePercent / 100) * multiplier);
  const stopFrac = Math.max(0.001, input.stopDistancePct / 100);
  const byRisk = riskDollars / stopFrac;
  const hardCap = input.equity * (input.hardMaxPositionPct / 100);

  let notional = byRisk;
  let cappedBy: SizeResult['cappedBy'] = 'risk';
  if (input.maxPositionDollars < notional) {
    notional = input.maxPositionDollars;
    cappedBy = 'maxPosition';
  }
  if (hardCap < notional) {
    notional = hardCap;
    cappedBy = 'hardLimit';
  }

  if (!Number.isFinite(notional) || notional <= 0 || input.price <= 0) {
    return { notional: 0, qty: 0, riskDollars, multiplier, cappedBy: 'none', reason: 'nothing to size' };
  }

  let qty: number;
  if (input.wholeShares) {
    qty = Math.floor(notional / input.price);
    if (qty < 1) {
      return {
        notional: 0,
        qty: 0,
        riskDollars,
        multiplier,
        cappedBy: 'lot',
        reason: `whole shares required: $${notional.toFixed(2)} buys < 1 share at $${input.price.toFixed(2)}`,
      };
    }
    notional = qty * input.price;
  } else {
    qty = notional / input.price;
  }

  notional = Math.floor(notional * 100) / 100;
  const reason = `risk $${riskDollars.toFixed(2)} (${input.riskPerTradePercent}% × ${multiplier.toFixed(2)}) / stop ${input.stopDistancePct.toFixed(2)}% = $${byRisk.toFixed(0)}; capped by ${cappedBy}`;
  return { notional, qty, riskDollars, multiplier, cappedBy, reason };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
