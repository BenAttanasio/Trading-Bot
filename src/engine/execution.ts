import { submitOrder, getOrder, AlpacaOrder } from '../services/alpaca/trading';
import { insertTrade, updateTradeStatus } from '../services/db/queries';
import { createTrade, Trade, TradeTrigger, OrderStatus, TradeIntent } from '../services/db/models/trade';
import { evaluateRisk, RiskCheckResult, intentFor } from './risk-manager';
import { insertDecisionLog } from '../services/db/queries';
import { DecisionLog } from '../services/db/models/decision-log';
import { isRegularHours } from '../services/scheduler/market-hours';
import { getBotState, setBotState } from '../services/db/bot-state';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('Execution');

export interface ExecutionRequest {
  symbol: string;
  /** Alpaca side. When `intent` is given the side is derived from it and this is ignored. */
  action: 'BUY' | 'SELL';
  /** open_long (default for BUY) | close_long (default for SELL) | open_short | close_short */
  intent?: TradeIntent;
  notional: number;
  /** Exact share quantity (exits/trims, and every short — Alpaca shorts need whole shares). */
  qty?: number;
  trigger: TradeTrigger;
  aiReasoning: string;
  aiConviction: number;
  sector?: string;
  marketDataSnapshot?: {
    price: number;
    volume: number;
    changePercent: number;
  };
  /** Extra structured AI output (thesis, prediction, exit conditions) kept in the decision log. */
  aiExtras?: Record<string, unknown>;
}

export interface ExecutionResult {
  success: boolean;
  trade?: Trade;
  order?: AlpacaOrder;
  riskCheck: RiskCheckResult;
  blockedReason?: string;
}

export function sideForIntent(intent: TradeIntent): 'buy' | 'sell' {
  return intent === 'open_long' || intent === 'close_short' ? 'buy' : 'sell';
}

function decisionForIntent(intent: TradeIntent): DecisionLog['decision'] {
  switch (intent) {
    case 'open_long': return 'BUY';
    case 'close_long': return 'SELL';
    case 'open_short': return 'SHORT';
    case 'close_short': return 'COVER';
  }
}

// Global kill switch — mirrored to bot_state so a restart cannot silently resume trading
let tradingPaused = false;
const PAUSED_KEY = 'tradingPaused';

/** Call once after the DB is connected. */
export async function loadTradingState(): Promise<void> {
  const saved = await getBotState<boolean>(PAUSED_KEY);
  tradingPaused = saved === true;
  if (tradingPaused) log.warn('Restored kill switch state: TRADING PAUSED');
}

export async function pauseTrading(): Promise<void> {
  tradingPaused = true;
  log.warn('TRADING PAUSED — kill switch activated');
  await setBotState(PAUSED_KEY, true);
}

export async function resumeTrading(): Promise<void> {
  tradingPaused = false;
  log.info('TRADING RESUMED');
  await setBotState(PAUSED_KEY, false);
}

export function isTradingPaused(): boolean {
  return tradingPaused;
}

export async function executeTrade(request: ExecutionRequest): Promise<ExecutionResult> {
  const intent = intentFor(request);
  const side = sideForIntent(intent);
  const action = side.toUpperCase() as 'BUY' | 'SELL';

  // Check kill switch
  if (tradingPaused) {
    log.warn(`Trade blocked by kill switch: ${intent} ${request.symbol}`);
    await logDecision(request, intent, 'BLOCKED', false, 'Trading paused (kill switch active)');
    return {
      success: false,
      riskCheck: {
        allPassed: false,
        details: { killSwitch: false },
        blockedReason: 'Trading paused (kill switch active)',
      },
      blockedReason: 'Trading paused (kill switch active)',
    };
  }

  // Shorts: whole shares only, and a quantity is mandatory
  if (intent === 'open_short') {
    const qty = Math.floor(request.qty ?? 0);
    if (qty < 1) {
      const reason = `Short ${request.symbol} needs a whole-share qty (got ${request.qty ?? 'none'})`;
      log.warn(reason);
      await logDecision(request, intent, 'BLOCKED', false, reason);
      return { success: false, riskCheck: { allPassed: false, details: { wholeShares: false }, blockedReason: reason }, blockedReason: reason };
    }
    request = { ...request, qty };
  }

  // Run risk checks
  const riskCheck = await evaluateRisk({
    symbol: request.symbol,
    action,
    intent,
    notional: request.notional,
    sector: request.sector,
  });

  // Log decision BEFORE execution
  await logDecision(
    request,
    intent,
    riskCheck.allPassed ? decisionForIntent(intent) : 'BLOCKED',
    riskCheck.allPassed,
    riskCheck.blockedReason
  );

  if (!riskCheck.allPassed) {
    return {
      success: false,
      riskCheck,
      blockedReason: riskCheck.blockedReason || 'Risk check failed',
    };
  }

  // Execute the trade
  try {
    const regularHours = await isRegularHours();
    const currentPrice = request.marketDataSnapshot?.price || 0;

    // Extended hours require a limit order, which needs a price
    if (!regularHours && currentPrice <= 0) {
      const reason = `Cannot submit extended-hours order for ${request.symbol}: no price available for limit order`;
      log.warn(reason);
      return {
        success: false,
        riskCheck,
        blockedReason: reason,
      };
    }

    const order = await submitOrder({
      symbol: request.symbol,
      side,
      notional: request.qty ? undefined : request.notional,
      qty: request.qty,
      // During extended hours, use limit order with current price
      extended_hours: !regularHours && currentPrice > 0,
      limit_price: !regularHours && currentPrice > 0 ? currentPrice : undefined,
    });

    if (!regularHours) {
      log.info(`Extended hours trade submitted for ${request.symbol}`);
    }

    const trade = createTrade({
      symbol: request.symbol,
      action,
      intent,
      quantity: 0, // will be updated after fill
      price: 0,    // will be updated after fill
      notional: request.notional,
      orderId: order.id,
      orderStatus: order.status as any,
      trigger: request.trigger,
      aiReasoning: request.aiReasoning,
      aiConviction: request.aiConviction,
      riskChecks: {
        allPassed: true,
        details: riskCheck.details,
      },
    });

    await insertTrade(trade);

    log.info(`Trade executed: ${intent} ${request.symbol} $${request.notional}`, {
      orderId: order.id,
      status: order.status,
      trigger: request.trigger,
      qty: request.qty,
    });

    // Poll for fill (non-blocking)
    pollForFill(order.id).catch((err) =>
      log.error(`Fill polling failed for ${order.id}`, { error: err })
    );

    return { success: true, trade, order, riskCheck };
  } catch (error) {
    log.error(`Trade execution failed: ${intent} ${request.symbol}`, { error });
    return {
      success: false,
      riskCheck,
      blockedReason: `Execution error: ${error}`,
    };
  }
}

async function pollForFill(orderId: string, maxAttempts: number = 10): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000)); // wait 2s between checks

    const order = await getOrder(orderId);
    if (order.status === 'filled') {
      await updateTradeStatus(orderId, 'filled', new Date(order.filled_at!));
      log.info(`Order filled: ${orderId}`, {
        qty: order.filled_qty,
        avgPrice: order.filled_avg_price,
      });
      return;
    }
    if (['cancelled', 'rejected', 'expired'].includes(order.status)) {
      await updateTradeStatus(orderId, order.status as OrderStatus);
      log.warn(`Order ${order.status}: ${orderId}`);
      return;
    }
  }

  log.warn(`Order still pending after ${maxAttempts} checks: ${orderId}`);
}

async function logDecision(
  request: ExecutionRequest,
  intent: TradeIntent,
  decision: DecisionLog['decision'],
  executed: boolean,
  blockedReason: string | null
): Promise<void> {
  const decisionLog: DecisionLog = {
    symbol: request.symbol,
    workflow: request.trigger === 'sentinel' ? 'sentinel' : request.trigger === 'morning_research' ? 'scout' : 'portfolio_manager',
    decision,
    executed,
    blockedReason,
    aiResponse: {
      reasoning: request.aiReasoning,
      conviction: request.aiConviction,
      intent,
      ...(request.aiExtras ?? {}),
    },
    marketDataSnapshot: request.marketDataSnapshot || {
      price: 0,
      volume: 0,
      changePercent: 0,
    },
    createdAt: new Date(),
  };

  await insertDecisionLog(decisionLog);
}
