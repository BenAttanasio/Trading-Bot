import { AlpacaPosition } from '../services/alpaca/trading';
import { Position, positionSide } from '../services/db/models/position';
import { ExitReason, realizedPLPercentFor } from '../services/db/models/trade-outcome';
import { TradeTrigger } from '../services/db/models/trade';
import { insertTradeOutcome, removePosition } from '../services/db/queries';
import { executeTrade, ExecutionResult } from './execution';
import { createServiceLogger } from '../utils/logger';
import { daysSince } from '../utils/time';

const log = createServiceLogger('Exits');

/**
 * The one way a position gets closed or trimmed: side-aware order, then a
 * trade_outcome the reflection layer can learn from. Used by the stop guard
 * (code-enforced exits) and the portfolio manager (AI exits).
 */
export interface CloseParams {
  alpacaPos: AlpacaPosition;
  stored: Position | null;
  exitReason: ExitReason;
  exitWorkflow: string;
  trigger: TradeTrigger;
  aiReasoning: string;
  aiConviction: number;
  /** 1 = close everything, 0.5 = trim half. */
  fraction?: number;
  currentVolume?: number;
}

export async function closePosition(params: CloseParams): Promise<ExecutionResult> {
  const { alpacaPos, stored } = params;
  const fraction = Math.min(1, Math.max(0.01, params.fraction ?? 1));
  const side = alpacaPos.side === 'short' ? 'short' : positionSide(stored);
  const qtyAbs = Math.abs(parseFloat(alpacaPos.qty));
  const marketValue = Math.abs(parseFloat(alpacaPos.market_value));
  const currentPrice = parseFloat(alpacaPos.current_price);
  const entryPrice = parseFloat(alpacaPos.avg_entry_price);
  const plPercent = parseFloat(alpacaPos.unrealized_plpc) * 100;

  let qty = fraction >= 1 ? qtyAbs : Math.floor(qtyAbs * fraction * 1e6) / 1e6;
  if (side === 'short') qty = fraction >= 1 ? qtyAbs : Math.floor(qtyAbs * fraction);
  if (qty <= 0) {
    log.warn(`${alpacaPos.symbol}: nothing to close (qty ${qtyAbs}, fraction ${fraction})`);
    return { success: false, riskCheck: { allPassed: false, details: {}, blockedReason: 'qty is zero' }, blockedReason: 'qty is zero' };
  }

  const result = await executeTrade({
    symbol: alpacaPos.symbol,
    action: side === 'long' ? 'SELL' : 'BUY',
    intent: side === 'long' ? 'close_long' : 'close_short',
    notional: marketValue * fraction,
    qty,
    trigger: params.trigger,
    aiReasoning: params.aiReasoning,
    aiConviction: params.aiConviction,
    marketDataSnapshot: { price: currentPrice, volume: params.currentVolume ?? 0, changePercent: plPercent },
  });

  if (!result.success) return result;

  if (stored) {
    const exitDate = new Date();
    const plPct = realizedPLPercentFor(side, entryPrice, currentPrice);
    const costBasis = Math.abs(parseFloat(alpacaPos.cost_basis)) || marketValue;
    await insertTradeOutcome({
      symbol: alpacaPos.symbol,
      side,
      entryTrigger: stored.entryTrigger,
      entryPrice,
      exitPrice: currentPrice,
      entryDate: new Date(stored.createdAt),
      exitDate,
      daysHeld: daysSince(new Date(stored.createdAt)),
      realizedPLPercent: plPct,
      realizedPLDollars: costBasis * fraction * (plPct / 100),
      aiConviction: params.aiConviction,
      originalThesis: stored.thesis,
      exitReason: params.exitReason,
      exitWorkflow: params.exitWorkflow,
      thesisFreshness: stored.thesisFreshness,
      createdAt: exitDate,
    }).catch((err) => log.error(`Failed to insert trade outcome for ${alpacaPos.symbol}`, { err }));
  }

  if (fraction >= 1) await removePosition(alpacaPos.symbol);
  log.info(`${fraction >= 1 ? 'Closed' : 'Trimmed'} ${side} ${alpacaPos.symbol} (${params.exitReason}) at $${currentPrice.toFixed(2)}, P&L ${plPercent.toFixed(2)}%`);
  return result;
}
