import { gatherMarketData, GatheredMarketData } from '../services/alpaca/gather-data';
import { callAIJson } from '../services/ai/client';
import { MORNING_RESEARCH_SYSTEM_PROMPT, buildMorningResearchPrompt } from '../services/ai/prompts/morning-research';
import { TRADE_DECISION_SYSTEM_PROMPT, buildNewTradeDecisionPrompt } from '../services/ai/prompts/trade-decision';
import { parseMorningResearch, parseNewTradeDecision, MorningResearchResult } from '../services/ai/parser';
import { getActiveWatchlist, getPosition, insertResearch, getAllPositions } from '../services/db/queries';
import { Research } from '../services/db/models/research';
import { executeTrade } from './execution';
import { TRADING_RULES } from '../config/trading-rules';
import { createServiceLogger } from '../utils/logger';
import { formatCurrency } from '../utils/formatters';

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

async function researchSymbol(symbol: string, sector: string): Promise<MorningResearchResult | null> {
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

  // Use deep model for morning research when we have good data, fast model when limited
  const useDeepModel = data.barCount >= 10;
  if (!useDeepModel) {
    log.info(`Using fast model for ${symbol} research (limited data: ${data.barCount} bars)`);
  }

  // Deep research with Claude
  const aiResponse = await callAIJson<Record<string, unknown>>({
    systemPrompt: MORNING_RESEARCH_SYSTEM_PROMPT,
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
    model: useDeepModel ? 'deep' : 'fast',
    maxTokens: 4096,
  });

  const research = parseMorningResearch(aiResponse);
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
    modelUsed: useDeepModel ? 'claude-opus-4-6' : 'claude-sonnet-4-20250514',
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

async function evaluateAndExecute(research: MorningResearchResult): Promise<void> {
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
  const aiResponse = await callAIJson<Record<string, unknown>>({
    systemPrompt: TRADE_DECISION_SYSTEM_PROMPT,
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
  });

  const decision = parseNewTradeDecision(aiResponse);
  log.info(`Trade decision for ${symbol}: ${decision.action}`, {
    conviction: decision.conviction,
    reasoning: decision.reasoning,
    size: decision.positionSize,
  });

  if (decision.action === 'BUY' && decision.conviction >= 6) {
    const currentVolume = data.dailyBar?.v || data.bars[data.bars.length - 1]?.v || 0;
    await executeTrade({
      symbol,
      action: 'BUY',
      notional: Math.min(decision.positionSize, TRADING_RULES.maxPositionSizeDollars),
      trigger: 'morning_research',
      aiReasoning: decision.reasoning,
      aiConviction: decision.conviction,
      marketDataSnapshot: {
        price: data.currentPrice,
        volume: currentVolume,
        changePercent: data.priceChange5d || 0,
      },
    });
  }
}

export async function researchAndTrade(symbol: string, sector: string, trigger: 'sentinel' | 'manual' = 'sentinel'): Promise<void> {
  log.info(`Sentinel-triggered research for ${symbol} — relaxed data requirements`);
  const research = await researchSymbol(symbol, sector);
  if (research && research.recommendation === 'BUY' && research.conviction >= 7) {
    await evaluateAndExecute(research);
  }
}
