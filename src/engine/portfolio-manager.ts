import { getPositions, AlpacaPosition } from '../services/alpaca/trading';
import { getBars, calculateRSI, calculateVolumeAverage, calculateATR, Bar } from '../services/alpaca/market-data';
import { getNewsForSymbol } from '../services/alpaca/news';
import { getMarketContext, formatMarketContext, sectorPerformanceLine, MarketContext } from '../services/alpaca/market-context';
import { callAIStructured } from '../services/ai/client';
import { getTradeDecisionSystemPrompt, buildPositionReviewPrompt } from '../services/ai/prompts/trade-decision';
import { getPlaybookBlock } from '../services/playbook';
import { PositionReviewSchema, normalizePositionReview } from '../services/ai/schemas';
import { getAllPositions, upsertPosition, removePosition, getPosition, getRecentDecisions, insertDecisionLog } from '../services/db/queries';
import { Position, calculateThesisFreshness, positionSide } from '../services/db/models/position';
import { executeTrade } from './execution';
import { closePosition } from './exits';
import { tightenStop } from './stop-guard';
import { resolveStop } from './sizing';
import { TRADING_RULES } from '../config/trading-rules';
import { createServiceLogger } from '../utils/logger';
import { daysSince, minutesSince } from '../utils/time';

const log = createServiceLogger('PortfolioManager');

export async function runPortfolioReview(): Promise<void> {
  log.info('Starting portfolio review...');

  const alpacaPositions = await getPositions();
  if (alpacaPositions.length === 0) {
    log.info('No open positions to review');
    return;
  }

  log.info(`Reviewing ${alpacaPositions.length} positions`);
  const ctx = await getMarketContext();

  for (const pos of alpacaPositions) {
    try {
      await reviewPosition(pos, ctx);
    } catch (error) {
      log.error(`Failed to review position: ${pos.symbol}`, { error });
    }
  }

  log.info('Portfolio review complete');
}

async function reviewPosition(alpacaPos: AlpacaPosition, ctx: MarketContext): Promise<void> {
  const symbol = alpacaPos.symbol;
  const side = alpacaPos.side === 'short' ? 'short' : 'long';
  const entryPrice = parseFloat(alpacaPos.avg_entry_price);
  const currentPrice = parseFloat(alpacaPos.current_price);
  const plPercent = parseFloat(alpacaPos.unrealized_plpc) * 100; // side-aware from Alpaca
  const marketValue = Math.abs(parseFloat(alpacaPos.market_value));
  const qtyAbs = Math.abs(parseFloat(alpacaPos.qty));

  // Get stored position data (thesis, guard levels, etc.)
  const storedPosition = await getPosition(symbol);
  const daysHeld = storedPosition
    ? daysSince(new Date(storedPosition.createdAt))
    : 0;
  const thesis = storedPosition?.thesis || 'No thesis recorded';

  // Fetch market data
  const [bars, news] = await Promise.all([
    getBars(symbol, '1Day', 20).then((r) => ({ bars: r.bars ?? [] })).catch(() => ({ bars: [] as Bar[] })),
    getNewsForSymbol(symbol, 5).catch(() => []),
  ]);

  const rsi = calculateRSI(bars.bars);
  const volumeAvg = calculateVolumeAverage(bars.bars);
  const currentVolume = bars.bars[bars.bars.length - 1]?.v || 0;
  const volumeVsAvg = volumeAvg > 0 ? currentVolume / volumeAvg : 1;

  // Legacy positions (opened before code-enforced exits) get an ATR stop from the current
  // price right away — before any cooldown gate — so nothing sits unguarded below entry.
  if (storedPosition && storedPosition.stopPrice == null) {
    const atr = calculateATR(bars.bars);
    const backfill = resolveStop({ price: currentPrice, side, proposedStop: null, atr: atr > 0 ? atr : null, atrMultiple: TRADING_RULES.atrStopMultiple });
    storedPosition.stopPrice = backfill.stopPrice;
    storedPosition.side = side;
    await upsertPosition(storedPosition);
    log.info(`${symbol}: backfilled ${backfill.source} stop $${backfill.stopPrice} (${backfill.stopDistancePct.toFixed(2)}% from $${currentPrice.toFixed(2)})`);
  }

  // Trailing stop floor (the stop guard also enforces this every tick; this is the fallback)
  if (storedPosition?.trailingStop) {
    const floorPercent = parseFloat(storedPosition.trailingStop.floor);
    if (plPercent <= floorPercent) {
      log.warn(`Trailing stop triggered for ${symbol}: P&L ${plPercent.toFixed(2)}% below floor ${floorPercent}%`);
      await closePosition({
        alpacaPos,
        stored: storedPosition,
        exitReason: 'trailing_stop',
        exitWorkflow: 'portfolio_manager',
        trigger: 'portfolio_manager',
        aiReasoning: `Trailing stop triggered: P&L dropped to ${plPercent.toFixed(2)}% below floor of ${floorPercent}%`,
        aiConviction: 9,
        currentVolume,
      });
      return;
    }
  }

  // Activate trailing stop if up enough
  if (
    plPercent >= TRADING_RULES.trailingStopActivation &&
    storedPosition &&
    !storedPosition.trailingStop
  ) {
    log.info(`Activating trailing stop for ${symbol} at +${plPercent.toFixed(2)}%`);
    storedPosition.trailingStop = {
      activatedAt: `${TRADING_RULES.trailingStopActivation}%`,
      floor: `${TRADING_RULES.trailingStopFloor}%`,
    };
    await upsertPosition(storedPosition);
  }

  // Check if thesis is stale and needs forced review
  const thesisFreshness = storedPosition
    ? calculateThesisFreshness(new Date(storedPosition.thesisLastUpdated))
    : 'stale';

  // Cooldown gate: skip AI re-evaluation if we reviewed this position recently
  const recentDecisions = await getRecentDecisions(symbol, 1);
  const lastDecision = recentDecisions[0];
  if (lastDecision) {
    const minutesAgo = minutesSince(new Date(lastDecision.createdAt));
    if (minutesAgo < TRADING_RULES.positionReviewCooldownMinutes) {
      log.info(`Skipping AI review for ${symbol} — last decision (${lastDecision.decision}) was ${minutesAgo}m ago (cooldown: ${TRADING_RULES.positionReviewCooldownMinutes}m)`);
      // Still update stored position prices without an AI call
      if (storedPosition) {
        await upsertPosition({
          ...storedPosition,
          side,
          currentPrice,
          unrealizedPL: parseFloat(alpacaPos.unrealized_pl),
          unrealizedPLPercent: plPercent,
          quantity: qtyAbs,
        });
      }
      return;
    }
  }

  // Ask AI for decision (deep tier + higher effort when the thesis is stale)
  const parsed = await callAIStructured({
    schema: PositionReviewSchema,
    systemPrompt: getTradeDecisionSystemPrompt(),
    cachedBlocks: [getPlaybookBlock()],
    userPrompt: buildPositionReviewPrompt({
      symbol,
      side,
      entryPrice,
      currentPrice,
      plPercent,
      daysHeld,
      originalThesis: thesis,
      recentNews: news.map((n) => ({ headline: n.headline, date: n.created_at.split('T')[0] })),
      rsi,
      volumeVsAvg,
      sectorPerformance: sectorPerformanceLine(ctx, storedPosition?.sector ?? ''),
      stopPrice: storedPosition?.stopPrice ?? null,
      targetPrice: storedPosition?.targetPrice ?? null,
      timeStopAt: storedPosition?.timeStopAt ? new Date(storedPosition.timeStopAt) : null,
      marketContext: formatMarketContext(ctx),
    }),
    model: thesisFreshness === 'stale' ? 'deep' : 'fast',
    effort: thesisFreshness === 'stale' ? 'high' : 'medium',
    purpose: `position-review ${symbol}`,
  });

  const decision = normalizePositionReview(parsed);
  log.info(`AI decision for ${symbol}: ${decision.action} (conviction: ${decision.conviction})`, {
    reasoning: decision.reasoning,
    newStop: decision.newStopPrice,
  });

  // Log all decisions (including HOLD) so cooldown gate and audit trail work correctly
  await insertDecisionLog({
    symbol,
    workflow: 'portfolio_manager',
    decision: decision.action as any,
    executed: false, // will be updated to true by executeTrade for EXIT/TRIM/ADD
    blockedReason: null,
    aiResponse: { reasoning: decision.reasoning, conviction: decision.conviction, newStopPrice: decision.newStopPrice },
    marketDataSnapshot: { price: currentPrice, volume: currentVolume, changePercent: plPercent },
    createdAt: new Date(),
  });

  // Execute action
  switch (decision.action) {
    case 'EXIT':
      if (marketValue < 1) {
        log.warn(`${symbol} position too small to close ($${marketValue.toFixed(4)}) — dropping from tracking`);
        await removePosition(symbol);
        return;
      }
      {
        const r = await closePosition({
          alpacaPos,
          stored: storedPosition,
          exitReason: 'ai_exit',
          exitWorkflow: 'portfolio_manager',
          trigger: 'portfolio_manager',
          aiReasoning: decision.reasoning,
          aiConviction: decision.conviction,
          currentVolume,
        });
        if (r.success) return;
      }
      break;

    case 'TRIM':
      if (marketValue * 0.5 >= 1) {
        await closePosition({
          alpacaPos,
          stored: storedPosition,
          exitReason: 'ai_trim',
          exitWorkflow: 'portfolio_manager',
          trigger: 'portfolio_manager',
          aiReasoning: `TRIM: ${decision.reasoning}`,
          aiConviction: decision.conviction,
          fraction: 0.5,
          currentVolume,
        });
      }
      break;

    case 'ADD': {
      if (side === 'short') {
        log.info(`ADD on a short (${symbol}) is not supported — holding`);
        break;
      }
      const addAmount = Math.min(TRADING_RULES.maxPositionSizeDollars * 0.5, TRADING_RULES.maxPositionSizeDollars - marketValue);
      if (addAmount > 5) {
        await executeTrade({
          symbol,
          action: 'BUY',
          intent: 'open_long',
          notional: addAmount,
          trigger: 'portfolio_manager',
          aiReasoning: `ADD: ${decision.reasoning}`,
          aiConviction: decision.conviction,
          marketDataSnapshot: { price: currentPrice, volume: currentVolume, changePercent: plPercent },
        });
      }
      break;
    }

    case 'HOLD':
    default:
      break;
  }

  // The review may only tighten the code-enforced stop
  const keptStop = tightenStop(side, storedPosition?.stopPrice ?? null, decision.newStopPrice, currentPrice);
  if (keptStop !== (storedPosition?.stopPrice ?? null)) {
    log.info(`${symbol}: stop tightened ${storedPosition?.stopPrice ?? 'none'} → ${keptStop}`);
  }

  // Update stored position
  const updatedPosition: Position = {
    ...(storedPosition || {
      createdAt: new Date(),
      trailingStop: null,
      entryTrigger: 'unknown',
      tags: [],
    }),
    symbol,
    side,
    entryPrice,
    currentPrice,
    quantity: qtyAbs,
    unrealizedPL: parseFloat(alpacaPos.unrealized_pl),
    unrealizedPLPercent: plPercent,
    daysHeld,
    thesis: decision.thesisUpdate || thesis,
    thesisLastUpdated: decision.thesisUpdate ? new Date() : (storedPosition?.thesisLastUpdated || new Date()),
    thesisFreshness: decision.thesisUpdate ? 'fresh' : thesisFreshness,
    exitConditions: decision.exitConditions,
    stopPrice: keptStop,
    lastReviewedAt: new Date(),
  };

  await upsertPosition(updatedPosition);
}

/** Exposed for tests/tools: which side a stored record is on. */
export { positionSide };
