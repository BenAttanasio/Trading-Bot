import { env } from '../config/env';
import { getPositions } from '../services/alpaca/trading';
import { getAllPositions } from '../services/db/queries';
import { Position, positionSide, PositionSide } from '../services/db/models/position';
import { ExitReason } from '../services/db/models/trade-outcome';
import { isTradingPaused } from './execution';
import { closePosition } from './exits';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('StopGuard');

/**
 * Code-enforced exits. No model in the loop: if price crosses the stop or the
 * target, or the horizon has elapsed, the position is closed. Runs every
 * sentinel tick (60 s) and at the start of every pulse.
 */

export type GuardVerdict =
  | { action: 'none' }
  | { action: 'exit'; reason: Extract<ExitReason, 'hard_stop' | 'target_hit' | 'time_stop' | 'trailing_stop'>; detail: string };

export type GuardPosition = Pick<Position, 'side' | 'stopPrice' | 'targetPrice' | 'timeStopAt' | 'trailingStop'>;

/** Pure. `plPercent` is the side-aware unrealized P&L (Alpaca's unrealized_plpc × 100). */
export function evaluateGuard(pos: GuardPosition, price: number, plPercent: number, now: Date = new Date()): GuardVerdict {
  const side = positionSide(pos);
  if (!(price > 0)) return { action: 'none' };

  const stop = pos.stopPrice ?? null;
  if (stop != null && stop > 0) {
    const hit = side === 'long' ? price <= stop : price >= stop;
    if (hit) return { action: 'exit', reason: 'hard_stop', detail: `Hard stop: ${side} price $${price.toFixed(2)} crossed stop $${stop.toFixed(2)} (P&L ${plPercent.toFixed(2)}%)` };
  }

  if (pos.trailingStop) {
    const floor = parseFloat(pos.trailingStop.floor);
    if (Number.isFinite(floor) && plPercent <= floor) {
      return { action: 'exit', reason: 'trailing_stop', detail: `Trailing stop: P&L ${plPercent.toFixed(2)}% fell to floor ${floor}%` };
    }
  }

  const target = pos.targetPrice ?? null;
  if (target != null && target > 0) {
    const hit = side === 'long' ? price >= target : price <= target;
    if (hit) return { action: 'exit', reason: 'target_hit', detail: `Target hit: ${side} price $${price.toFixed(2)} reached target $${target.toFixed(2)} (P&L ${plPercent.toFixed(2)}%)` };
  }

  const timeStop = pos.timeStopAt ? new Date(pos.timeStopAt) : null;
  if (timeStop && now.getTime() >= timeStop.getTime()) {
    return { action: 'exit', reason: 'time_stop', detail: `Time stop: horizon elapsed ${timeStop.toISOString().slice(0, 10)} without the target (P&L ${plPercent.toFixed(2)}%)` };
  }

  return { action: 'none' };
}

/**
 * Pure. Accept a proposed stop only if it is on the losing side of price AND
 * tighter (closer to price) than the current one. Returns the stop to keep.
 */
export function tightenStop(side: PositionSide, current: number | null | undefined, proposed: number | null | undefined, price: number): number | null {
  const cur = current != null && current > 0 ? current : null;
  if (proposed == null || !Number.isFinite(proposed) || proposed <= 0 || !(price > 0)) return cur;
  const onLosingSide = side === 'long' ? proposed < price : proposed > price;
  if (!onLosingSide) return cur;
  if (cur == null) return proposed;
  const tighter = side === 'long' ? proposed > cur : proposed < cur;
  return tighter ? proposed : cur;
}

let running = false;

export async function runStopGuard(): Promise<{ checked: number; exits: number }> {
  if (!env.STOP_GUARD_ENABLED || isTradingPaused() || running) return { checked: 0, exits: 0 };
  running = true;
  let exits = 0;
  let checked = 0;
  try {
    const alpacaPositions = await getPositions();
    if (alpacaPositions.length === 0) return { checked: 0, exits: 0 };
    const stored = new Map((await getAllPositions()).map((p) => [p.symbol, p]));

    for (const ap of alpacaPositions) {
      const pos = stored.get(ap.symbol);
      if (!pos) continue; // nothing recorded → nothing to enforce
      checked += 1;
      const price = parseFloat(ap.current_price);
      const plPercent = parseFloat(ap.unrealized_plpc) * 100;
      const verdict = evaluateGuard({ ...pos, side: ap.side === 'short' ? 'short' : positionSide(pos) }, price, plPercent);
      if (verdict.action !== 'exit') continue;

      log.warn(`${ap.symbol}: ${verdict.detail}`);
      try {
        const result = await closePosition({
          alpacaPos: ap,
          stored: pos,
          exitReason: verdict.reason,
          exitWorkflow: 'stop_guard',
          trigger: 'portfolio_manager',
          aiReasoning: verdict.detail,
          aiConviction: 10,
        });
        if (result.success) exits += 1;
        else log.warn(`${ap.symbol}: guard exit not executed — ${result.blockedReason}`);
      } catch (error) {
        log.error(`${ap.symbol}: guard exit failed`, { error });
      }
    }
  } catch (error) {
    log.error('Stop guard tick failed', { error });
  } finally {
    running = false;
  }
  if (exits > 0) log.info(`Stop guard: ${exits} exit(s) from ${checked} guarded positions`);
  return { checked, exits };
}
