import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/alpaca/client', () => ({ getAccount: vi.fn() }));
vi.mock('../src/services/alpaca/trading', () => ({ getPositions: vi.fn() }));
vi.mock('../src/services/db/queries', () => ({
  getTradesToday: vi.fn(),
  getTradesForSymbol: vi.fn(),
  getRecentDecisions: vi.fn(),
}));

import { getAccount } from '../src/services/alpaca/client';
import { getPositions } from '../src/services/alpaca/trading';
import { getTradesToday, getTradesForSymbol, getRecentDecisions } from '../src/services/db/queries';
import { evaluateRisk } from '../src/engine/risk-manager';
import { TRADING_RULES } from '../src/config/trading-rules';
import { HARD_LIMITS } from '../src/config/hard-limits';

const mockAccount = (portfolio: number, lastEquity: number) =>
  vi.mocked(getAccount).mockResolvedValue({
    portfolio_value: String(portfolio),
    last_equity: String(lastEquity),
    cash: String(portfolio),
    long_market_value: '0',
  } as any);

beforeEach(() => {
  vi.resetAllMocks();
  mockAccount(100_000, 100_000);
  vi.mocked(getPositions).mockResolvedValue([]);
  vi.mocked(getTradesToday).mockResolvedValue([]);
  vi.mocked(getTradesForSymbol).mockResolvedValue([]);
  vi.mocked(getRecentDecisions).mockResolvedValue([]);
});

describe('evaluateRisk', () => {
  it('approves a small buy with a clean slate', async () => {
    const notional = Math.min(10, TRADING_RULES.maxPositionSizeDollars);
    const result = await evaluateRisk({ symbol: 'AAPL', action: 'BUY', notional });
    expect(result.allPassed).toBe(true);
    expect(result.blockedReason).toBeNull();
  });

  it('blocks a buy larger than the configured position size', async () => {
    const result = await evaluateRisk({
      symbol: 'AAPL',
      action: 'BUY',
      notional: TRADING_RULES.maxPositionSizeDollars + 1,
    });
    expect(result.allPassed).toBe(false);
    expect(result.details.positionSizeWithinLimit).toBe(false);
  });

  it('blocks a buy that breaches the hard % of equity ceiling even if the rules allow the dollar amount', async () => {
    mockAccount(100, 100); // tiny account: 25% of equity = $25
    const notional = Math.min(TRADING_RULES.maxPositionSizeDollars, 100 * (HARD_LIMITS.maxPositionPercentOfEquity / 100) + 1);
    const result = await evaluateRisk({ symbol: 'AAPL', action: 'BUY', notional });
    expect(result.details.withinHardPositionLimit).toBe(false);
    expect(result.allPassed).toBe(false);
  });

  it('trips the daily loss circuit breaker', async () => {
    mockAccount(90_000, 100_000); // -10%
    const result = await evaluateRisk({ symbol: 'AAPL', action: 'BUY', notional: 5 });
    expect(result.details.dailyLossCircuitBreakerOff).toBe(false);
    expect(result.blockedReason).toMatch(/Circuit breaker/);
  });

  it('never blocks a sell for position size, but does enforce the sell cooldown', async () => {
    vi.mocked(getTradesForSymbol).mockResolvedValue([
      { symbol: 'AAPL', action: 'SELL', price: 10, createdAt: new Date() } as any,
    ]);
    const result = await evaluateRisk({ symbol: 'AAPL', action: 'SELL', notional: 1_000_000 });
    expect(result.details.positionSizeWithinLimit).toBe(true);
    expect(result.details.notInCooldown).toBe(false);
  });

  it('fails closed when a dependency throws', async () => {
    vi.mocked(getAccount).mockRejectedValue(new Error('alpaca down'));
    const result = await evaluateRisk({ symbol: 'AAPL', action: 'BUY', notional: 5 });
    expect(result.allPassed).toBe(false);
    expect(result.blockedReason).toMatch(/Risk evaluation error/);
  });
});
