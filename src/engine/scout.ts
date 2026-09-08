import { gatherMarketData, gatherMany, GatheredMarketData } from '../services/alpaca/gather-data';
import { getBarsMulti, Bar } from '../services/alpaca/market-data';
import { getMarketContext, formatMarketContext, relativeStrength5d, MarketContext, INDEX_ETFS, SECTOR_ETFS } from '../services/alpaca/market-context';
import { buildUniverse, UniverseEntry } from '../services/alpaca/screener';
import { getAsset } from '../services/alpaca/trading';
import { getFilingsMany, getRecentFilings, formatFilings, edgarEnabled } from '../services/edgar/filings';
import { callAIStructured, BudgetExceededError, MODEL_IDS, ModelTier } from '../services/ai/client';
import { getMorningResearchSystemPrompt, buildMorningResearchPrompt } from '../services/ai/prompts/morning-research';
import { getTradeDecisionSystemPrompt, buildNewTradeDecisionPrompt } from '../services/ai/prompts/trade-decision';
import { getRankingSystemPrompt, buildRankingPrompt, RankingCandidateInput } from '../services/ai/prompts/ranking';
import {
  MorningResearchSchema,
  NewTradeDecisionSchema,
  RankingSchema,
  normalizeMorningResearch,
  normalizeNewTradeDecision,
  normalizeRanking,
  MorningResearchResult,
  RankingResult,
  RankingCandidate,
} from '../services/ai/schemas';
import {
  getActiveWatchlist,
  getPosition,
  insertResearch,
  getAllPositions,
  upsertPosition,
  getQueuedAlerts,
  markAlertActioned,
} from '../services/db/queries';
import { getScoredPredictions, insertRanking } from '../services/db/learning-queries';
import { Research } from '../services/db/models/research';
import { PositionSide, positionSide } from '../services/db/models/position';
import { executeTrade } from './execution';
import { resolveStop, resolveTarget, sizePosition, CalibrationSummary } from './sizing';
import { computeCalibration, dueDateFor } from './predictions';
import { TRADING_RULES } from '../config/trading-rules';
import { HARD_LIMITS } from '../config/hard-limits';
import { env } from '../config/env';
import { getAccount } from '../services/alpaca/client';
import { createServiceLogger } from '../utils/logger';
import { formatCurrency } from '../utils/formatters';
import { getETDateISO } from '../utils/time';
import { getPlaybookBlock } from '../services/playbook';
import { buildInitialDeploymentNote } from '../services/ai/prompts/shared';
import { recordPrediction } from './predictions';

const log = createServiceLogger('Scout');

type Trigger = 'morning_research' | 'sentinel' | 'manual';

// ─── Morning cycle: universe → one ranking call → top picks → per-name decision ──

export async function runMorningResearch(): Promise<void> {
  log.info('Starting morning research cycle...');

  const watchlist = await getActiveWatchlist();
  if (watchlist.length === 0) {
    log.warn('Watchlist is empty — nothing to research');
    return;
  }

  // Initial-deployment mode: when the book is (almost) all cash, lower the conviction
  // bar a notch so the first session actually puts capital to work instead of nibbling.
  let investedPct = 0;
  const held = new Map<string, PositionSide>();
  try {
    const [account, positions] = await Promise.all([getAccount(), getAllPositions()]);
    const equity = parseFloat(account.portfolio_value);
    const invested = positions.reduce((s, p) => s + Math.abs(p.currentPrice * p.quantity), 0);
    investedPct = equity > 0 ? (invested / equity) * 100 : 0;
    for (const p of positions) held.set(p.symbol, positionSide(p));
  } catch (error) {
    log.warn('Could not compute invested %, assuming normal mode', { error });
  }
  const initialDeployment = investedPct < env.INITIAL_DEPLOYMENT_BELOW_PERCENT;
  const convictionBar = initialDeployment ? 5 : 6;
  const initialNote = initialDeployment
    ? buildInitialDeploymentNote(investedPct, env.MORNING_MAX_BUYS, TRADING_RULES.maxPositionSizeDollars)
    : undefined;
  if (initialDeployment) {
    log.info(`Initial deployment mode: ${investedPct.toFixed(1)}% invested — conviction bar ${convictionBar}`);
  }

  const universe = await buildUniverse({
    watchlist,
    maxCandidates: env.UNIVERSE_MAX_CANDIDATES,
    minPrice: env.UNIVERSE_MIN_PRICE,
    minDollarVolume: env.UNIVERSE_MIN_DOLLAR_VOLUME,
    includeScreener: env.UNIVERSE_SCREENER,
    exclude: [...INDEX_ETFS, ...Object.values(SECTOR_ETFS)],
  });

  const rankOpts = {
    held,
    initialDeploymentNote: initialNote,
    maxLongs: env.MORNING_MAX_BUYS,
    maxShorts: env.ENABLE_SHORTS ? env.MORNING_MAX_SHORTS : 0,
    persist: true,
  };
  let ranked: RankOutput | null = null;
  try {
    ranked = await rankUniverse({ universe, ...rankOpts });
  } catch (error: any) {
    if (!/max_tokens/.test(String(error?.message))) throw error;
    // Output overflowed: rank the watchlist-first half of the slate instead of giving up the day.
    const smaller = universe.slice(0, Math.max(5, Math.ceil(universe.length / 2)));
    log.warn(`Ranking overflowed the output cap with ${universe.length} names — retrying with ${smaller.length}`);
    ranked = await rankUniverse({ universe: smaller, ...rankOpts });
  }
  if (!ranked) {
    log.warn('Ranking produced nothing — no entries today');
    return;
  }
  const { ranking, data, ctx, filings } = ranked;
  const sectorOf = new Map(universe.map((u) => [u.symbol, u.sector]));

  const longs = ranking.candidates
    .filter((c) => c.side === 'long' && c.score > 0 && c.conviction >= convictionBar && !held.has(c.symbol) && data.has(c.symbol))
    .sort((a, b) => b.score - a.score)
    .slice(0, env.MORNING_MAX_BUYS);
  const shorts = env.ENABLE_SHORTS
    ? ranking.candidates
        .filter((c) => c.side === 'short' && c.score < 0 && c.conviction >= convictionBar && !held.has(c.symbol) && data.has(c.symbol))
        .sort((a, b) => a.score - b.score)
        .slice(0, env.MORNING_MAX_SHORTS)
    : [];

  log.info(`Ranking: ${longs.length} long / ${shorts.length} short candidates above bar ${convictionBar}`, {
    regime: ranking.regime,
    longs: longs.map((c) => `${c.symbol}:${c.score}`),
    shorts: shorts.map((c) => `${c.symbol}:${c.score}`),
    marketRead: ranking.marketRead,
  });

  const context = initialNote ? [initialNote] : [];
  for (const c of [...longs, ...shorts]) {
    try {
      await evaluateAndExecute(researchFromCandidate(c), 'morning_research', {
        side: c.side === 'short' ? 'short' : 'long',
        sector: sectorOf.get(c.symbol) ?? '',
        data: data.get(c.symbol),
        ctx,
        context,
        proposedStop: c.invalidationPrice,
        proposedTarget: c.targetPrice,
        horizonDays: c.horizonDays,
        filings: filings.get(c.symbol),
      });
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        log.warn('Daily token budget exceeded — stopping morning entries');
        break;
      }
      log.error(`Failed to evaluate/execute candidate: ${c.symbol}`, { error });
    }
  }

  log.info('Morning research cycle complete');
}

export interface RankInputs {
  universe: UniverseEntry[];
  /** Replay: ISO instant; bars/news end here and no snapshot is used. */
  asOf?: string;
  held?: Map<string, PositionSide>;
  initialDeploymentNote?: string;
  model?: ModelTier;
  maxLongs: number;
  maxShorts: number;
  /** Store research docs + ranking snapshot (live only). */
  persist?: boolean;
  /** Pre-fetched bars (replay batches them). */
  barsBySymbol?: Record<string, Bar[]>;
  marketContext?: MarketContext;
}

export interface RankOutput {
  ranking: RankingResult;
  data: Map<string, GatheredMarketData>;
  ctx: MarketContext;
  /** Formatted SEC filing lines per symbol (empty map when EDGAR is disabled). */
  filings: Map<string, string[]>;
  candidatesSent: number;
}

/**
 * One structured call over the whole slate. Shared by the live morning cycle and
 * the offline replay so both are judged on identical inputs.
 */
export async function rankUniverse(inputs: RankInputs): Promise<RankOutput | null> {
  const symbols = inputs.universe.map((u) => u.symbol);
  if (symbols.length === 0) return null;

  let barsBySymbol = inputs.barsBySymbol;
  if (!barsBySymbol) {
    barsBySymbol = await getBarsMulti(symbols, '1Day', 30, inputs.asOf).catch((error) => {
      log.warn('Batch bars failed; falling back to per-symbol requests', { error });
      return undefined;
    });
  }

  const data = await gatherMany(symbols, { asOf: inputs.asOf, barsBySymbol, newsLimit: 6, concurrency: 5 });
  if (data.size === 0) {
    log.warn('No candidate had price data');
    return null;
  }

  const ctx = inputs.marketContext ?? (await getMarketContext(inputs.asOf));

  const filings = new Map<string, string[]>();
  if (edgarEnabled()) {
    const raw = await getFilingsMany([...data.keys()], 10, inputs.asOf);
    for (const [sym, list] of raw) filings.set(sym, formatFilings(list));
    log.info(`EDGAR: filings for ${filings.size}/${data.size} candidates`);
  }

  const candidates: RankingCandidateInput[] = inputs.universe
    .filter((u) => data.has(u.symbol))
    .map((u) => {
      const d = data.get(u.symbol)!;
      return {
        symbol: u.symbol,
        sector: u.sector,
        source: u.source,
        note: u.note,
        price: d.currentPrice,
        change1dPct: d.priceChange1d,
        change5dPct: d.priceChange5d,
        change1mPct: d.priceChange1m,
        relStrength5dPct: relativeStrength5d(ctx, d.priceChange5d),
        rsi: d.rsi,
        sma20: d.sma20,
        atrPct: d.atrPct,
        volumeVsAvg: d.volumeVsAvg,
        news: d.news.map((n) => ({ headline: n.headline, date: n.created_at.split('T')[0] })),
        filings: filings.get(u.symbol),
        held: inputs.held?.get(u.symbol) ?? null,
      };
    });

  const tier: ModelTier = inputs.model ?? 'deep';
  const parsed = await callAIStructured({
    schema: RankingSchema,
    systemPrompt: getRankingSystemPrompt(),
    cachedBlocks: [getPlaybookBlock()],
    userPrompt: buildRankingPrompt({
      dateISO: inputs.asOf ? inputs.asOf.slice(0, 10) : getETDateISO(),
      marketContext: formatMarketContext(ctx),
      candidates,
      maxLongs: inputs.maxLongs,
      maxShorts: inputs.maxShorts,
      shortsEnabled: inputs.maxShorts > 0,
      initialDeploymentNote: inputs.initialDeploymentNote,
    }),
    model: tier,
    // Thinking tokens count against max_tokens: medium effort + a 20k cap leaves
    // room for ~30 candidates of structured output without hitting the ceiling.
    effort: 'medium',
    maxTokens: 20000,
    budgetSensitive: tier === 'budget',
    purpose: `ranking ${candidates.length} names`,
  });
  const ranking = normalizeRanking(parsed);

  if (inputs.persist) {
    const now = new Date();
    await insertRanking({
      date: getETDateISO(),
      marketRead: ranking.marketRead,
      regime: ranking.regime,
      universeSize: candidates.length,
      candidates: ranking.candidates,
      modelUsed: MODEL_IDS[tier],
      createdAt: now,
    }).catch((err) => log.warn('Could not store ranking snapshot', { err }));
    for (const c of ranking.candidates) {
      if (c.side === 'none') continue;
      const doc: Research = {
        symbol: c.symbol,
        type: 'ranking',
        side: c.side,
        score: c.score,
        summary: c.summary,
        fullAnalysis: JSON.stringify(c),
        sentiment: c.side === 'long' ? 'bullish' : 'bearish',
        conviction: c.conviction,
        catalysts: c.catalysts,
        risks: c.risks,
        priceTarget: c.targetPrice != null ? String(c.targetPrice) : null,
        recommendation: c.side === 'long' ? 'BUY' : 'SELL',
        modelUsed: MODEL_IDS[tier],
        createdAt: now,
      };
      await insertResearch(doc).catch((err) => log.warn(`Could not store ranking research for ${c.symbol}`, { err }));
    }
  }

  return { ranking, data, ctx, filings, candidatesSent: candidates.length };
}

export function researchFromCandidate(c: RankingCandidate): MorningResearchResult {
  return {
    symbol: c.symbol,
    sentiment: c.side === 'long' ? 'bullish' : c.side === 'short' ? 'bearish' : 'neutral',
    conviction: c.conviction,
    summary: c.summary,
    catalysts: c.catalysts,
    risks: c.risks,
    technicalOutlook: '',
    fundamentalOutlook: '',
    recommendation: c.side === 'long' ? 'BUY' : c.side === 'short' ? 'SELL' : 'WATCH',
    priceTarget: c.targetPrice != null ? String(c.targetPrice) : null,
    stopLoss: c.invalidationPrice != null ? String(c.invalidationPrice) : null,
    timeHorizon: `${c.horizonDays} trading days`,
    positionSizeRecommendation: 0,
  };
}

// ─── Single-name research (sentinel escalations, manual, queued alerts) ─────

async function researchSymbol(
  symbol: string,
  sector: string,
  budgetMode = false,
  context: string[] = [],
  type: Research['type'] = 'sentinel_escalation'
): Promise<{ research: MorningResearchResult; data: GatheredMarketData; ctx: MarketContext } | null> {
  log.info(`Researching ${symbol}...`);

  const [data, ctx] = await Promise.all([gatherMarketData(symbol), getMarketContext()]);

  if (data.currentPrice === 0) {
    log.warn(`No price data available for ${symbol} (no snapshot, no bars) — skipping`, {
      available: data.available,
      missing: data.missing,
    });
    return null;
  }

  const existingPosition = await getPosition(symbol);

  // Budget mode (queued alerts): cheap model with budget cap. Otherwise fast tier.
  const modelTier: ModelTier = budgetMode ? 'budget' : 'fast';

  const parsed = await callAIStructured({
    schema: MorningResearchSchema,
    systemPrompt: getMorningResearchSystemPrompt(),
    cachedBlocks: [getPlaybookBlock()],
    contextBlocks: context,
    userPrompt: buildMorningResearchPrompt({
      symbol,
      sector,
      currentPrice: data.currentPrice,
      priceSource: data.priceSource,
      priceChange5d: data.priceChange5d,
      priceChange1m: data.priceChange1m,
      change1dPct: data.priceChange1d,
      rsi: data.rsi,
      sma20: data.sma20,
      atrPct: data.atrPct,
      volumeVsAvg: data.volumeVsAvg,
      recentNews: data.news.map((n) => ({
        headline: n.headline,
        date: n.created_at.split('T')[0],
      })),
      existingPosition: !!existingPosition,
      existingThesis: existingPosition?.thesis,
      availableData: data.available,
      missingData: data.missing,
      marketContext: formatMarketContext(ctx),
    }),
    model: modelTier,
    effort: 'medium',
    budgetSensitive: budgetMode,
    purpose: `research ${symbol}`,
  });

  const research = normalizeMorningResearch(parsed, TRADING_RULES.maxPositionSizeDollars);
  research.symbol = symbol;

  const researchDoc: Research = {
    symbol,
    type,
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

  return { research, data, ctx };
}

// ─── Per-name decision + sizing + execution ───────────────────────────────

let calibrationCache: { at: number; value: CalibrationSummary } | null = null;
async function currentCalibration(): Promise<CalibrationSummary> {
  if (calibrationCache && Date.now() - calibrationCache.at < 10 * 60 * 1000) return calibrationCache.value;
  try {
    const cal = computeCalibration(await getScoredPredictions(90));
    calibrationCache = { at: Date.now(), value: { n: cal.n, hitRate: cal.hitRate } };
  } catch (error) {
    log.warn('Calibration unavailable — sizing at 1.0x', { error });
    calibrationCache = { at: Date.now(), value: { n: 0, hitRate: null } };
  }
  return calibrationCache.value;
}

function parsePrice(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface EvaluateOptions {
  side: PositionSide;
  sector: string;
  data?: GatheredMarketData;
  ctx?: MarketContext;
  context?: string[];
  proposedStop?: number | null;
  proposedTarget?: number | null;
  horizonDays?: number | null;
  filings?: string[];
}

async function evaluateAndExecute(research: MorningResearchResult, trigger: Trigger, opts: EvaluateOptions): Promise<void> {
  const symbol = research.symbol;
  const side = opts.side;
  log.info(`Evaluating ${side} ${symbol} (research conviction: ${research.conviction})`);

  const [positions, account] = await Promise.all([getAllPositions(), getAccount()]);
  const equity = parseFloat(account.portfolio_value);
  const positionCount = positions.length;
  const totalInvested = positions.reduce((sum, p) => sum + Math.abs(p.currentPrice * p.quantity), 0);
  const portfolioContext = `Currently holding ${positionCount} positions with ${formatCurrency(totalInvested)} gross exposure out of ${formatCurrency(TRADING_RULES.maxPortfolioExposure)} max. Equity ${formatCurrency(equity)}.`;

  const data = opts.data ?? (await gatherMarketData(symbol, { newsLimit: 5 }));
  if (data.currentPrice === 0) {
    log.warn(`Cannot evaluate trade for ${symbol} — no price data available`);
    return;
  }
  const ctx = opts.ctx ?? (await getMarketContext());
  const price = data.currentPrice;

  const parsed = await callAIStructured({
    schema: NewTradeDecisionSchema,
    systemPrompt: getTradeDecisionSystemPrompt(),
    cachedBlocks: [getPlaybookBlock()],
    contextBlocks: opts.context ?? [],
    userPrompt: buildNewTradeDecisionPrompt({
      symbol,
      sector: opts.sector,
      side,
      currentPrice: price,
      researchSummary: research.summary,
      conviction: research.conviction,
      catalysts: research.catalysts,
      risks: research.risks,
      proposedStop: opts.proposedStop ?? parsePrice(research.stopLoss),
      proposedTarget: opts.proposedTarget ?? parsePrice(research.priceTarget),
      horizonDays: opts.horizonDays ?? null,
      rsi: data.rsi,
      sma20: data.sma20,
      atr: data.atr,
      atrPct: data.atrPct,
      volumeVsAvg: data.volumeVsAvg,
      change1dPct: data.priceChange1d,
      portfolioContext,
      marketContext: formatMarketContext(ctx),
      filings: opts.filings ?? (edgarEnabled() ? formatFilings(await getRecentFilings(symbol, 10)) : undefined),
      availableData: data.available,
      missingData: data.missing,
    }),
    model: 'fast',
    effort: 'medium',
    purpose: `trade-decision ${side} ${symbol}`,
  });

  const decision = normalizeNewTradeDecision(parsed, TRADING_RULES.maxPositionSizeDollars);
  log.info(`Trade decision for ${side} ${symbol}: ${decision.action}`, {
    conviction: decision.conviction,
    reasoning: decision.reasoning,
    stop: decision.stopPrice,
    target: decision.targetPrice,
    prediction: decision.prediction,
  });

  let execution: Awaited<ReturnType<typeof executeTrade>> | null = null;
  let stopPrice: number | null = null;
  let targetPrice: number | null = null;
  let sizingNote = '';

  if (decision.action === 'BUY' && decision.conviction >= 4) {
    const stop = resolveStop({
      price,
      side,
      proposedStop: decision.stopPrice ?? opts.proposedStop,
      atr: data.atr,
      atrMultiple: TRADING_RULES.atrStopMultiple,
    });
    stopPrice = stop.stopPrice;
    targetPrice = resolveTarget(price, side, decision.targetPrice ?? opts.proposedTarget, stop.stopDistancePct);

    // Asset gate: tradable, and for shorts shortable + easy to borrow. Whole shares when not fractionable.
    const asset = await getAsset(symbol);
    let wholeShares = side === 'short';
    let blocked: string | null = null;
    if (asset) {
      if (!asset.tradable || asset.status !== 'active') blocked = `${symbol} is not tradable`;
      else if (side === 'short' && !(asset.shortable && asset.easy_to_borrow)) blocked = `${symbol} is not easy to borrow`;
      if (!asset.fractionable) wholeShares = true;
    }

    if (blocked) {
      log.warn(blocked);
      sizingNote = blocked;
    } else {
      const size = sizePosition({
        equity,
        price,
        side,
        stopDistancePct: stop.stopDistancePct,
        riskPerTradePercent: TRADING_RULES.riskPerTradePercent,
        maxPositionDollars: TRADING_RULES.maxPositionSizeDollars,
        hardMaxPositionPct: HARD_LIMITS.maxPositionPercentOfEquity,
        calibration: await currentCalibration(),
        minScoredForCalibration: env.MIN_SCORED_FOR_TUNING,
        wholeShares,
      });
      sizingNote = `${size.reason}; stop ${stop.source} $${stop.stopPrice} (${stop.stopDistancePct.toFixed(2)}%), target $${targetPrice}`;
      log.info(`Sizing ${side} ${symbol}: $${size.notional} (${size.qty.toFixed(4)} sh)`, { sizing: sizingNote });

      if (size.notional > 0) {
        const currentVolume = data.dailyBar?.v || data.bars[data.bars.length - 1]?.v || 0;
        execution = await executeTrade({
          symbol,
          action: side === 'long' ? 'BUY' : 'SELL',
          intent: side === 'long' ? 'open_long' : 'open_short',
          notional: size.notional,
          qty: wholeShares ? size.qty : undefined,
          trigger,
          sector: opts.sector,
          aiReasoning: decision.reasoning,
          aiConviction: decision.conviction,
          marketDataSnapshot: {
            price,
            volume: currentVolume,
            changePercent: data.priceChange1d ?? data.priceChange5d ?? 0,
          },
          aiExtras: {
            side,
            thesis: decision.thesis,
            prediction: decision.prediction,
            exitConditions: decision.exitConditions,
            timeHorizon: decision.timeHorizon,
            stopPrice,
            targetPrice,
            sizing: sizingNote,
            researchConviction: research.conviction,
            catalysts: research.catalysts,
            risks: research.risks,
          },
        });
      } else {
        log.warn(`Not entering ${side} ${symbol}: ${size.reason}`);
      }
    }
  }

  // A fresh entry gets its thesis + code-enforced exits on the position record immediately
  // (the review loop refreshes qty/P&L later), so the guard and the dashboard know what we hold.
  if (execution?.success && !(await getPosition(symbol))) {
    const now = new Date();
    const horizonDays = opts.horizonDays ?? decision.prediction.horizonDays;
    await upsertPosition({
      symbol,
      side,
      sector: opts.sector,
      entryPrice: price,
      currentPrice: price,
      quantity: 0,
      unrealizedPL: 0,
      unrealizedPLPercent: 0,
      daysHeld: 0,
      thesis: decision.thesis,
      thesisLastUpdated: now,
      thesisFreshness: 'fresh',
      exitConditions: decision.exitConditions,
      trailingStop: null,
      stopPrice,
      targetPrice,
      timeStopAt: dueDateFor(now, horizonDays),
      atrAtEntry: data.atr,
      horizonDays,
      entryTrigger: trigger,
      tags: [research.sentiment, `conviction:${decision.conviction}`, side],
      createdAt: now,
      lastReviewedAt: now,
    }).catch((err) => log.warn(`Could not seed position record for ${symbol}`, { err }));
  }

  // Every decision — entry or PASS — leaves a scorable prediction behind.
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
  log.info(`${trigger} research for ${symbol}`);
  const out = await researchSymbol(symbol, sector, budgetMode);
  if (!out) return;
  const { research, data, ctx } = out;
  const existing = await getPosition(symbol);

  if (research.recommendation === 'BUY' && research.conviction >= 6 && !existing) {
    await evaluateAndExecute(research, trigger, { side: 'long', sector, data, ctx });
  } else if (research.recommendation === 'SELL' && research.conviction >= 6 && !existing && env.ENABLE_SHORTS) {
    await evaluateAndExecute(research, trigger, { side: 'short', sector, data, ctx });
  } else if (existing) {
    log.info(`${symbol} already held (${positionSide(existing)}) — leaving to the portfolio manager`);
  }
}

/**
 * Intraday scouting: only names the sentinel queued (urgency 4-6) since the last
 * pulse, cheapest model. No more researching random watchlist names every 30 min.
 */
export async function runIntradayScouting(): Promise<void> {
  const windowMinutes = TRADING_RULES.intradayPulseIntervalMinutes * 2;
  const alerts = await getQueuedAlerts(windowMinutes, 10);
  if (alerts.length === 0) {
    log.info('No queued sentinel alerts — nothing to scout');
    return;
  }

  const positions = await getAllPositions();
  const heldSymbols = new Set(positions.map((p) => p.symbol));
  const watchlist = await getActiveWatchlist();
  const sectorOf = new Map(watchlist.map((w) => [w.symbol, w.sector]));

  const seen = new Set<string>();
  const picks = alerts.filter((a) => {
    if (seen.has(a.symbol) || heldSymbols.has(a.symbol)) return false;
    seen.add(a.symbol);
    return true;
  }).slice(0, 2);

  log.info(`Scouting ${picks.length} queued alert(s): ${picks.map((a) => `${a.symbol}[${a.urgency}]`).join(', ')}`);
  for (const alert of picks) {
    try {
      if (alert._id) await markAlertActioned(alert._id, 'triggered_deep_research');
      await researchAndTrade(alert.symbol, sectorOf.get(alert.symbol) ?? '', 'sentinel', true);
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        log.warn('Daily token budget exceeded — stopping intraday scouting');
        break;
      }
      log.error(`Intraday scouting failed for ${alert.symbol}`, { error });
    }
  }
  // Anything queued but not picked this pulse is stale by the next one
  for (const a of alerts) {
    if (a._id && !picks.includes(a)) await markAlertActioned(a._id, 'ignored').catch(() => undefined);
  }
}
