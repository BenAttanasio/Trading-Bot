import { submitOrder, getOrder, AlpacaOrder } from '../services/alpaca/trading';
import { insertTrade, updateTradeStatus } from '../services/db/queries';
import { createTrade, Trade, TradeTrigger, OrderStatus } from '../services/db/models/trade';
import { evaluateRisk, RiskCheckResult } from './risk-manager';
import { insertDecisionLog } from '../services/db/queries';
import { DecisionLog } from '../services/db/models/decision-log';
import { isRegularHours } from '../services/scheduler/market-hours';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('Execution');

export interface ExecutionRequest {
  symbol: string;
  action: 'BUY' | 'SELL';
  notional: number;
  trigger: TradeTrigger;
  aiReasoning: string;
  aiConviction: number;
  sector?: string;
  marketDataSnapshot?: {
    price: number;
    volume: number;
    changePercent: number;
  };
}

export interface ExecutionResult {
  success: boolean;
  trade?: Trade;
  order?: AlpacaOrder;
  riskCheck: RiskCheckResult;
  blockedReason?: string;
}

// Global kill switch
let tradingPaused = false;

export function pauseTrading(): void {
  tradingPaused = true;
  log.warn('TRADING PAUSED — kill switch activated');
}

export function resumeTrading(): void {
  tradingPaused = false;
  log.info('TRADING RESUMED');
}

export function isTradingPaused(): boolean {
  return tradingPaused;
}

export async function executeTrade(request: ExecutionRequest): Promise<ExecutionResult> {
  // Check kill switch
  if (tradingPaused) {
    log.warn(`Trade blocked by kill switch: ${request.action} ${request.symbol}`);
    await logDecision(request, 'BLOCKED', false, 'Trading paused (kill switch active)');
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

  // Run risk checks
  const riskCheck = await evaluateRisk({
    symbol: request.symbol,
    action: request.action,
    notional: request.notional,
    sector: request.sector,
  });

  // Log decision BEFORE execution
  await logDecision(
    request,
    riskCheck.allPassed ? request.action : 'BLOCKED',
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
      side: request.action.toLowerCase() as 'buy' | 'sell',
      notional: request.notional,
      // During extended hours, use limit order with current price
      extended_hours: !regularHours && currentPrice > 0,
      limit_price: !regularHours && currentPrice > 0 ? currentPrice : undefined,
    });

    if (!regularHours) {
      log.info(`Extended hours trade submitted for ${request.symbol}`);
    }

    const trade = createTrade({
      symbol: request.symbol,
      action: request.action,
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

    log.info(`Trade executed: ${request.action} ${request.symbol} $${request.notional}`, {
      orderId: order.id,
      status: order.status,
      trigger: request.trigger,
    });

    // Poll for fill (non-blocking)
    pollForFill(order.id).catch((err) =>
      log.error(`Fill polling failed for ${order.id}`, { error: err })
    );

    return { success: true, trade, order, riskCheck };
  } catch (error) {
    log.error(`Trade execution failed: ${request.action} ${request.symbol}`, { error });
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
  decision: string,
  executed: boolean,
  blockedReason: string | null
): Promise<void> {
  const decisionLog: DecisionLog = {
    symbol: request.symbol,
    workflow: request.trigger === 'sentinel' ? 'sentinel' : request.trigger === 'morning_research' ? 'scout' : 'portfolio_manager',
    decision: decision as any,
    executed,
    blockedReason,
    aiResponse: {
      reasoning: request.aiReasoning,
      conviction: request.aiConviction,
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
