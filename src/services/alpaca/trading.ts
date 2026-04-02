import { alpacaRequest } from './client';
import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('AlpacaTrading');

// ─── Types ───────────────────────────────────────────────

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  qty: string | null;
  notional: string | null;
  side: 'buy' | 'sell';
  type: string;
  time_in_force: string;
  status: string;
  filled_qty: string;
  filled_avg_price: string | null;
  created_at: string;
  filled_at: string | null;
  submitted_at: string;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  avg_entry_price: string;
  qty: string;
  side: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
}

interface OrderParams {
  symbol: string;
  notional?: number;   // dollar amount (for fractional shares)
  qty?: number;        // share quantity
  side: 'buy' | 'sell';
  type?: 'market' | 'limit' | 'stop' | 'stop_limit';
  time_in_force?: 'day' | 'gtc' | 'ioc';
  limit_price?: number;
  extended_hours?: boolean; // enable extended hours trading (requires limit order)
}

// ─── Orders ──────────────────────────────────────────────

export async function submitOrder(params: OrderParams): Promise<AlpacaOrder> {
  let orderType = params.type || 'market';
  const body: Record<string, unknown> = {
    symbol: params.symbol,
    side: params.side,
    time_in_force: params.time_in_force || 'day',
  };

  // Extended hours trading: Alpaca requires limit orders (no market/notional)
  if (params.extended_hours && params.limit_price) {
    orderType = 'limit';
    body.extended_hours = true;

    // Convert notional to qty since Alpaca doesn't support notional + limit
    if (params.notional && params.limit_price > 0) {
      const qty = Math.floor((params.notional / params.limit_price) * 1000) / 1000;
      body.qty = qty.toString();
    } else if (params.qty) {
      body.qty = params.qty.toString();
    }

    // Set limit price with small buffer (0.5% for buys above, sells below)
    const buffer = params.limit_price * 0.005;
    const limitPrice = params.side === 'buy'
      ? params.limit_price + buffer
      : Math.max(0.01, params.limit_price - buffer);
    body.limit_price = limitPrice.toFixed(2);

    log.info(`Extended hours order: converting to limit @ $${limitPrice.toFixed(2)}`, {
      originalNotional: params.notional,
      computedQty: body.qty,
    });
  } else {
    // Regular hours: use notional (dollar-based, fractional shares)
    if (params.notional) {
      body.notional = params.notional.toFixed(2);
    } else if (params.qty) {
      body.qty = params.qty.toString();
    } else {
      throw new Error('Either notional or qty must be provided');
    }

    if (params.limit_price) {
      orderType = 'limit';
      body.limit_price = params.limit_price.toFixed(2);
    }
  }

  body.type = orderType;

  log.info(`Submitting ${params.side} order: ${params.symbol}`, {
    notional: params.notional,
    qty: body.qty,
    type: orderType,
    extendedHours: !!params.extended_hours,
  });

  const order = await alpacaRequest<AlpacaOrder>('/v2/orders', {
    method: 'POST',
    body,
  });

  log.info(`Order submitted: ${order.id} | Status: ${order.status}`);
  return order;
}

export async function getOrder(orderId: string): Promise<AlpacaOrder> {
  return alpacaRequest<AlpacaOrder>(`/v2/orders/${orderId}`);
}

export async function getOpenOrders(): Promise<AlpacaOrder[]> {
  return alpacaRequest<AlpacaOrder[]>('/v2/orders', {
    params: { status: 'open' },
  });
}

export async function cancelOrder(orderId: string): Promise<void> {
  await alpacaRequest(`/v2/orders/${orderId}`, { method: 'DELETE' });
  log.info(`Order cancelled: ${orderId}`);
}

export async function cancelAllOrders(): Promise<void> {
  await alpacaRequest('/v2/orders', { method: 'DELETE' });
  log.info('All open orders cancelled');
}

// ─── Positions ───────────────────────────────────────────

export async function getPositions(): Promise<AlpacaPosition[]> {
  return alpacaRequest<AlpacaPosition[]>('/v2/positions');
}

export async function getPositionForSymbol(symbol: string): Promise<AlpacaPosition | null> {
  try {
    return await alpacaRequest<AlpacaPosition>(`/v2/positions/${symbol}`);
  } catch (error) {
    // 404 means no position
    return null;
  }
}

export async function closePosition(symbol: string): Promise<AlpacaOrder> {
  return alpacaRequest<AlpacaOrder>(`/v2/positions/${symbol}`, {
    method: 'DELETE',
  });
}

export async function closeAllPositions(): Promise<void> {
  await alpacaRequest('/v2/positions', {
    method: 'DELETE',
    params: { cancel_orders: 'true' },
  });
  log.info('All positions closed');
}
