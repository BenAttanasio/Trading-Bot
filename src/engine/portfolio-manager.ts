import { getPositions, AlpacaPosition } from '../services/alpaca/trading';
import { getSnapshot, getBars, calculateRSI, calculateVolumeAverage, Bar } from '../services/alpaca/market-data';
import { getNewsForSymbol } from '../services/alpaca/news';
import { callAIJson } from '../services/ai/client';
import { TRADE_DECISION_SYSTEM_PROMPT, buildPositionReviewPrompt } from '../services/ai/prompts/trade-decision';
import { parsePositionReview, PositionReviewResult } from '../services/ai/parser';
import { getAllPositions, upsertPosition, removePosition, getPosition, getRecentDecisions, insertDecisionLog, insertTradeOutcome } from '../services/db/queries';
import { Position, calculateThesisFreshness } from '../services/db/models/position';
import { executeTrade } from './execution';
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

  for (const pos of alpacaPositions) {
    try {
      await reviewPosition(pos);
    } catch (error) {
      log.error(`Failed to review position: ${pos.symbol}`, { error });
    }
  }

  log.info('Portfolio review complete');
}

async function reviewPosition(alpacaPos: AlpacaPosition): Promise<void> {
  const symbol = alpacaPos.symbol;
  const entryPrice = parseFloat(alpacaPos.avg_entry_price);
  const currentPrice = parseFloat(alpacaPos.current_price);
  const plPercent = parseFloat(alpacaPos.unrealized_plpc) * 100;
  const marketValue = parseFloat(alpacaPos.market_value);

  // Get stored position data (thesis, etc.)
  let storedPosition = await getPosition(symbol);
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

  // Check trailing stop
  if (storedPosition?.trailingStop) {
    const floorPercent = parseFloat(storedPosition.trailingStop.floor);
    if (plPercent <= floorPercent) {
      log.warn(`Trailing stop triggered for ${symbol}: P&L ${plPercent.toFixed(2)}% below floor ${floorPercent}%`);
      const trailingResult = await executeTrade({
        symbol,
        action: 'SELL',
        notional: marketValue,
        trigger: 'portfolio_manager',
        aiReasoning: `Trailing stop triggered: P&L dropped to ${plPercent.toFixed(2)}% below floor of ${floorPercent}%`,
        aiConviction: 9,
        marketDataSnapshot: { price: currentPrice, volume: currentVolume, changePercent: plPercent },
      });
      if (trailingResult.success && storedPosition) {
        const exitDate = new Date();
        const plPct = ((currentPrice - entryPrice) / entryPrice) * 100;
        await insertTradeOutcome({
          symbol,
          entryTrigger: storedPosition.entryTrigger,
          entryPrice,
          exitPrice: currentPrice,
          entryDate: new Date(storedPosition.createdAt),
          exitDate,
          daysHeld: daysSince(new Date(storedPosition.createdAt)),
          realizedPLPercent: plPct,
          realizedPLDollars: marketValue * (plPct / 100),
          aiConviction: 0,
          originalThesis: storedPosition.thesis,
          exitReason: 'trailing_stop',
          exitWorkflow: 'portfolio_manager',
          thesisFreshness: storedPosition.thesisFreshness,
          createdAt: exitDate,
        }).catch((err) => log.error(`Failed to insert trade outcome for ${symbol}`, { err }));
      }
      await removePosition(symbol);
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
          currentPrice,
          unrealizedPL: parseFloat(alpacaPos.unrealized_pl),
          unrealizedPLPercent: plPercent,
          quantity: parseFloat(alpacaPos.qty),
        });
      }
      return;
    }
  }

  // Ask AI for decision
  const aiResponse = await callAIJson<Record<string, unknown>>({
    systemPrompt: TRADE_DECISION_SYSTEM_PROMPT,
    userPrompt: buildPositionReviewPrompt({
      symbol,
      entryPrice,
      currentPrice,
      plPercent,
      daysHeld,
      originalThesis: thesis,
      recentNews: news.map((n) => ({ headline: n.headline, date: n.created_at.split('T')[0] })),
      rsi,
      volumeVsAvg,
      sectorPerformance: 'market average', // simplified
    }),
    model: thesisFreshness === 'stale' ? 'deep' : 'fast',
  });

  const decision = parsePositionReview(aiResponse);
  log.info(`AI decision for ${symbol}: ${decision.action} (conviction: ${decision.conviction})`, {
    reasoning: decision.reasoning,
  });

  // Log all decisions (including HOLD) so cooldown gate and audit trail work correctly
  await insertDecisionLog({
    symbol,
    workflow: 'portfolio_manager',
    decision: decision.action as any,
    executed: false, // will be updated to true by executeTrade for EXIT/TRIM/ADD
    blockedReason: null,
    aiResponse: { reasoning: decision.reasoning, conviction: decision.conviction },
    marketDataSnapshot: { price: currentPrice, volume: currentVolume, changePercent: plPercent },
    createdAt: new Date(),
  });

  // Execute action
  switch (decision.action) {
    case 'EXIT':
      if (marketValue < 1) {
        log.warn(`${symbol} position too small to sell ($${marketValue.toFixed(4)}) — dropping from tracking`);
        await removePosition(symbol);
      } else {
        const exitResult = await executeTrade({
          symbol,
          action: 'SELL',
          notional: marketValue,
          trigger: 'portfolio_manager',
          aiReasoning: decision.reasoning,
          aiConviction: decision.conviction,
          marketDataSnapshot: { price: currentPrice, volume: currentVolume, changePercent: plPercent },
        });
        if (exitResult.success) {
          if (storedPosition) {
            const exitDate = new Date();
            const plPct = ((currentPrice - entryPrice) / entryPrice) * 100;
            await insertTradeOutcome({
              symbol,
              entryTrigger: storedPosition.entryTrigger,
              entryPrice,
              exitPrice: currentPrice,
              entryDate: new Date(storedPosition.createdAt),
              exitDate,
              daysHeld: daysSince(new Date(storedPosition.createdAt)),
              realizedPLPercent: plPct,
              realizedPLDollars: marketValue * (plPct / 100),
              aiConviction: decision.conviction,
              originalThesis: storedPosition.thesis,
              exitReason: 'ai_exit',
              exitWorkflow: 'portfolio_manager',
              thesisFreshness: storedPosition.thesisFreshness,
              createdAt: exitDate,
            }).catch((err) => log.error(`Failed to insert trade outcome for ${symbol}`, { err }));
          }
          await removePosition(symbol);
        }
      }
      break;

    case 'TRIM': {
      const trimAmount = marketValue * 0.5; // sell half
      if (trimAmount >= 1) {
        const trimResult = await executeTrade({
          symbol,
          action: 'SELL',
          notional: trimAmount,
          trigger: 'portfolio_manager',
          aiReasoning: `TRIM: ${decision.reasoning}`,
          aiConviction: decision.conviction,
          marketDataSnapshot: { price: currentPrice, volume: currentVolume, changePercent: plPercent },
        });
        if (trimResult.success && storedPosition) {
          const exitDate = new Date();
          const plPct = ((currentPrice - entryPrice) / entryPrice) * 100;
          await insertTradeOutcome({
            symbol,
            entryTrigger: storedPosition.entryTrigger,
            entryPrice,
            exitPrice: currentPrice,
            entryDate: new Date(storedPosition.createdAt),
            exitDate,
            daysHeld: daysSince(new Date(storedPosition.createdAt)),
            realizedPLPercent: plPct,
            realizedPLDollars: trimAmount * (plPct / 100),
            aiConviction: decision.conviction,
            originalThesis: storedPosition.thesis,
            exitReason: 'ai_trim',
            exitWorkflow: 'portfolio_manager',
            thesisFreshness: storedPosition.thesisFreshness,
            createdAt: exitDate,
          }).catch((err) => log.error(`Failed to insert trim outcome for ${symbol}`, { err }));
        }
      }
      break;
    }

    case 'ADD':
      const addAmount = Math.min(TRADING_RULES.maxPositionSizeDollars * 0.5, TRADING_RULES.maxPositionSizeDollars - marketValue);
      if (addAmount > 5) {
        await executeTrade({
          symbol,
          action: 'BUY',
          notional: addAmount,
          trigger: 'portfolio_manager',
          aiReasoning: `ADD: ${decision.reasoning}`,
          aiConviction: decision.conviction,
          marketDataSnapshot: { price: currentPrice, volume: currentVolume, changePercent: plPercent },
        });
      }
      break;

    case 'HOLD':
    default:
      break;
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
    entryPrice,
    currentPrice,
    quantity: parseFloat(alpacaPos.qty),
    unrealizedPL: parseFloat(alpacaPos.unrealized_pl),
    unrealizedPLPercent: plPercent,
    daysHeld,
    thesis: decision.thesisUpdate || thesis,
    thesisLastUpdated: decision.thesisUpdate ? new Date() : (storedPosition?.thesisLastUpdated || new Date()),
    thesisFreshness: decision.thesisUpdate ? 'fresh' : thesisFreshness,
    exitConditions: decision.exitConditions,
    lastReviewedAt: new Date(),
  };

  await upsertPosition(updatedPosition);
}
