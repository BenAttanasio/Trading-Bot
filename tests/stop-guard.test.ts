import { describe, it, expect } from 'vitest';
import { evaluateGuard, tightenStop } from '../src/engine/stop-guard';

const now = new Date('2026-09-08T15:00:00Z');

describe('evaluateGuard', () => {
  it('does nothing while price is between stop and target before the horizon', () => {
    const v = evaluateGuard({ side: 'long', stopPrice: 95, targetPrice: 110, timeStopAt: new Date('2026-09-20'), trailingStop: null }, 100, 0, now);
    expect(v.action).toBe('none');
  });

  it('fires the hard stop for a long that trades through it', () => {
    const v = evaluateGuard({ side: 'long', stopPrice: 95, targetPrice: 110, timeStopAt: null, trailingStop: null }, 94.9, -5.1, now);
    expect(v).toMatchObject({ action: 'exit', reason: 'hard_stop' });
  });

  it('fires the hard stop for a short when price rises through it', () => {
    const v = evaluateGuard({ side: 'short', stopPrice: 105, targetPrice: 90, timeStopAt: null, trailingStop: null }, 105.5, -5.5, now);
    expect(v).toMatchObject({ action: 'exit', reason: 'hard_stop' });
  });

  it('takes the target on either side', () => {
    expect(evaluateGuard({ side: 'long', stopPrice: 95, targetPrice: 110, timeStopAt: null, trailingStop: null }, 110, 10, now)).toMatchObject({ reason: 'target_hit' });
    expect(evaluateGuard({ side: 'short', stopPrice: 105, targetPrice: 90, timeStopAt: null, trailingStop: null }, 89, 11, now)).toMatchObject({ reason: 'target_hit' });
  });

  it('honours the trailing-stop floor before the target', () => {
    const v = evaluateGuard({ side: 'long', stopPrice: 90, targetPrice: 130, timeStopAt: null, trailingStop: { activatedAt: '10%', floor: '5%' } }, 104, 4, now);
    expect(v).toMatchObject({ action: 'exit', reason: 'trailing_stop' });
  });

  it('exits when the horizon elapses', () => {
    const v = evaluateGuard({ side: 'long', stopPrice: 95, targetPrice: 110, timeStopAt: new Date('2026-09-08T14:00:00Z'), trailingStop: null }, 101, 1, now);
    expect(v).toMatchObject({ action: 'exit', reason: 'time_stop' });
  });

  it('treats legacy records (no side, no levels) as unguarded longs', () => {
    expect(evaluateGuard({ trailingStop: null }, 50, -20, now).action).toBe('none');
  });
});

describe('tightenStop', () => {
  it('accepts a tighter long stop and rejects a looser one', () => {
    expect(tightenStop('long', 90, 95, 100)).toBe(95);
    expect(tightenStop('long', 95, 90, 100)).toBe(95);
  });

  it('accepts a tighter short stop and rejects a looser one', () => {
    expect(tightenStop('short', 110, 105, 100)).toBe(105);
    expect(tightenStop('short', 105, 110, 100)).toBe(105);
  });

  it('never moves the stop to the winning side of price', () => {
    expect(tightenStop('long', 90, 101, 100)).toBe(90);
    expect(tightenStop('short', 110, 99, 100)).toBe(110);
  });

  it('sets a stop when none existed, and keeps null on garbage', () => {
    expect(tightenStop('long', null, 97, 100)).toBe(97);
    expect(tightenStop('long', null, Number.NaN, 100)).toBeNull();
  });
});
