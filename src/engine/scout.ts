import { gatherMarketData, GatheredMarketData } from '../services/alpaca/gather-data';
import { callAIStructured, BudgetExceededError, MODEL_IDS } from '../services/ai/client';
import { getMorningResearchSystemPrompt, buildMorningResearchPrompt } from '../services/ai/prompts/morning-research';
import { getTradeDecisionSystemPrompt, buildNewTradeDecisionPrompt } from '../services/ai/prompts/trade-decision';
import {
  MorningResearchSchema,
  NewTradeDecisionSchema,
  normalizeMorningResearch,
  normalizeNewTradeDecision,
  MorningResearchResult,
} from '../services/ai/schemas';
import { getActiveWatchlist, getPosition, insertResearch, getAllPositions } from '../services/db/queries';
import { Research } from '../services/db/models/research';
import { executeTrade } from './execution';
import { TRADING_RULES } from '../config/trading-rules';
import { createServiceLogger } from '../utils/logger';
import { formatCurrency } from '../utils/formatters';
import { getPlaybookBlock } from '../services/playbook';
import { recordPrediction } from './predictions';

const log = createServiceLogger('Scout');

export async function runMorningResearch(): Promise<void> {
  log.info('Starting morning research cycle...');

  const watchlist = await getActiveWatchlist();
  if (watchlist.length === 0) {
    log.warn('Watchlist is empty — nothing to research');
    return;
  }

  log.info(`Researching ${watchlist.length} stocks on watchlist`);

  const opportunities: MorningResearchResult[] = [];

  for (const item of watchlist) {
    try {
      const research = await researchSymbol(item.symbol, item.sector);
      if (research && research.recommendation === 'BUY' && research.conviction >= 6) {
        opportunities.push(research);
      }
    } catch (error) {
      log.error(`Research failed for ${item.symbol}`, { error });
    }
  }

  // Sort by conviction, process top opportunities
  opportunities.sort((a, b) => b.conviction - a.conviction);
  log.info(`Found ${opportunities.length} buy opportunities`);

  for (const opp of opportunities.slice(0, 3)) {
    try {
      await evaluateAndExecute(opp);
    } catch (error) {
      log.error(`Failed to evaluate/execute opportunity: ${opp.symbol}`, { error });
    }
  }

  log.info('Morning research cycle complete');
}

async function researchSymbol(symbol: string, sector: string, budgetMode = false): Promise<MorningResearchResult | null> {
  log.info(`Researching ${symbol}...`);

  // Gather all available market data — never fails, just reports what's missing
  const data = await gatherMarketData(symbol);

  // Only skip if we have absolutely no price at all
  if (data.currentPrice === 0) {
    log.warn(`No price data available for ${symbol} (no snapshot, no bars) — skipping`, {
      available: data.available,
      missing: data.missing,
    });
    return null;
  }

  // Check if we already hold this stock
  const existingPosition = await getPosition(symbol);

  // Budget mode (intraday scouting): always use cheap Haiku model with budget cap
  // Morning research: deep model when data is good, fast when limited
  const modelTier = budgetMode ? 'budget' : (data.barCount >= 10 ? 'deep' : 'fast');
  if (budgetMode) {
    log.info(`Using budget model for ${symbol} (intraday scouting)`);
  } else if (modelTier === 'fast') {
    log.info(`Using fast model for ${symbol} research (limited data: ${data.barCount} bars)`);
  }

  // Research with Claude (structured output, adaptive thinking on fast/deep tiers)
  const parsed = await callAIStructured({
    schema: MorningResearchSchema,
    systemPrompt: getMorningResearchSystemPrompt(),
    cachedBlocks: [getPlaybookBlock()],
    userPrompt: buildMorningResearchPrompt({
      symbol,
      sector,
      currentPrice: data.currentPrice,
      priceSource: data.priceSource,
      priceChange5d: data.priceChange5d,
      priceChange1m: data.priceChange1m,
      rsi: data.rsi,
      sma20: data.sma20,
      volumeVsAvg: data.volumeVsAvg,
      recentNews: data.news.map((n) => ({
        headline: n.headline,
        date: n.created_at.split('T')[0],
      })),
      existingPosition: !!existingPosition,
      existingThesis: existingPosition?.thesis,
      availableData: data.available,
      missingData: data.missing,
    }),
    model: modelTier,
    effort: modelTier === 'deep' ? 'high' : 'medium',
    budgetSensitive: budgetMode,
    purpose: `research ${symbol}`,
  });

  const research = normalizeMorningResearch(parsed, TRADING_RULES.maxPositionSizeDollars);
  research.symbol = symbol;

  // Store research report
  const researchDoc: Research = {
    symbol,
    type: 'morning_research',
    summary: research.summary,
    fullAnalysis: JSON.stringify(research),
    sentiment: research.sentiment,
    conviction: research.conviction,
    catalysts: research.catalysts,
    risks: research.risks,
    priceTarget: research.priceTarget,
    recommendation: research.recommendation,
    modelUsed: MODEL_IDS[modelTier],
    createdAt: new Date(),
  };
  await insertResearch(researchDoc);

  log.info(`Research complete for ${symbol}: ${research.recommendation} (conviction: ${research.conviction})`, {
    sentiment: research.sentiment,
    summary: research.summary,
    dataQuality: `${data.barCount} bars, ${data.available.length} signals available, ${data.missing.length} missing`,
  });

  return research;
}

async function evaluateAndExecute(research: MorningResearchResult, trigger: 'morning_research' | 'sentinel' | 'manual' = 'morning_research'): Promise<void> {
  const symbol = research.symbol;
  log.info(`Evaluating trade for ${symbol} (conviction: ${research.conviction})`);

  // Get current portfolio context
  const positions = await getAllPositions();
  const positionCount = positions.length;
  const totalInvested = positions.reduce((sum, p) => sum + (p.currentPrice * p.quantity), 0);

  const portfolioContext = `Currently holding ${positionCount} positions with ${formatCurrency(totalInvested)} invested out of ${formatCurrency(TRADING_RULES.maxPortfolioExposure)} max exposure.`;

  // Gather fresh price data with snapshot fallback
  const data = await gatherMarketData(symbol, 5);

  if (data.currentPrice === 0) {
    log.warn(`Cannot evaluate trade for ${symbol} — no price data available`);
    return;
  }

  // Get trade decision from AI
  const parsed = await callAIStructured({
    schema: NewTradeDecisionSchema,
    systemPrompt: getTradeDecisionSystemPrompt(),
    cachedBlocks: [getPlaybookBlock()],
    userPrompt: buildNewTradeDecisionPrompt({
      symbol,
      sector: '',
      currentPrice: data.currentPrice,
      researchSummary: research.summary,
      conviction: research.conviction,
      catalysts: research.catalysts,
      risks: research.risks,
      rsi: data.rsi,
      sma20: data.sma20,
      volumeVsAvg: data.volumeVsAvg,
      portfolioContext,
      availableData: data.available,
      missingData: data.missing,
    }),
    model: 'fast',
    effort: 'medium',
    purpose: `trade-decision ${symbol}`,
  });

  const decision = normalizeNewTradeDecision(parsed, TRADING_RULES.maxPositionSizeDollars);
  log.info(`Trade decision for ${symbol}: ${decision.action}`, {
    conviction: decision.conviction,
    reasoning: decision.reasoning,
    size: decision.positionSize,
    prediction: decision.prediction,
  });

  let execution: Awaited<ReturnType<typeof executeTrade>> | null = null;
  if (decision.action === 'BUY' && decision.conviction >= 4) {
    const currentVolume = data.dailyBar?.v || data.bars[data.bars.length - 1]?.v || 0;
    execution = await executeTrade({
      symbol,
      action: 'BUY',
      notional: Math.min(decision.positionSize, TRADING_RULES.maxPositionSizeDollars),
      trigger,
      aiReasoning: decision.reasoning,
      aiConviction: decision.conviction,
      marketDataSnapshot: {
        price: data.currentPrice,
        volume: currentVolume,
        changePercent: data.priceChange5d || 0,
      },
      aiExtras: {
        thesis: decision.thesis,
        prediction: decision.prediction,
        exitConditions: decision.exitConditions,
        timeHorizon: decision.timeHorizon,
        researchConviction: research.conviction,
        catalysts: research.catalysts,
        risks: research.risks,
      },
    });
  }

  // Every decision — BUY or PASS — leaves a scorable prediction behind.
  await recordPrediction({
    symbol,
    decision,
    research,
    data,
    trigger,
    acted: execution?.success === true,
    orderId: execution?.order?.id ?? null,
    modelUsed: MODEL_IDS.fast,
  });
}

export async function researchAndTrade(symbol: string, sector: string, trigger: 'sentinel' | 'manual' = 'sentinel', budgetMode = false): Promise<void> {
  log.info(`Sentinel-triggered research for ${symbol} — relaxed data requirements`);
  const research = await researchSymbol(symbol, sector, budgetMode);
  if (research && research.recommendation === 'BUY' && research.conviction >= 6) {
    await evaluateAndExecute(research, trigger);
  }
}

/** Lightweight scouting for the intraday pulse.
 *  Picks up to 2 watchlist symbols not already held and evaluates them. */
export async function runIntradayScouting(): Promise<void> {
  log.info('Starting intraday scouting...');

  const watchlist = await getActiveWatchlist();
  if (watchlist.length === 0) {
    log.info('Watchlist empty — no intraday scouting');
    return;
  }

  const positions = await getAllPositions();
  const heldSymbols = new Set(positions.map((p) => p.symbol));
  const candidates = watchlist.filter((item) => !heldSymbols.has(item.symbol));

  if (candidates.length === 0) {
    log.info('All watchlist symbols already held — skipping scouting');
    return;
  }

  const toResearch = candidates.slice(0, 2);
  for (const item of toResearch) {
    try {
      await researchAndTrade(item.symbol, item.sector, 'sentinel', true);
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        log.warn('Daily token budget exceeded — stopping intraday scouting');
        break;
      }
      log.error(`Intraday scouting failed for ${item.symbol}`, { error });
    }
  }

  log.info('Intraday scouting complete');
}
