import { Router } from 'express';
import { getRecentReflections, getScoredPredictions, getRecentPredictions, getChangeRequests, getLatestRanking, getBenchmarks } from '../../services/db/learning-queries';
import { getRecentOutcomes, getDailySummaries } from '../../services/db/queries';
import { getAccount } from '../../services/alpaca/client';
import { getDetailedTokenUsage } from '../../services/ai/client';
import { getPlaybook, getPlaybookVersions } from '../../services/playbook';
import { computeCalibration } from '../../engine/predictions';
import { getBenchmarkComparison } from '../../engine/benchmark';
import { computeTradeStats, computeEquityStats, computeAICostStats } from '../../engine/stats';
import { TUNABLE_BOUNDS } from '../../config/hard-limits';
import { TRADING_RULES, getDefaultRules } from '../../config/trading-rules';
import { env } from '../../config/env';

export const learningRouter = Router();

// GET /api/learning/stats — expectancy, profit factor, Sharpe, drawdown, AI cost vs equity
learningRouter.get('/stats', async (req, res) => {
  try {
    const [outcomes, benchmarks, summaries, account, scored] = await Promise.all([
      getRecentOutcomes(500),
      getBenchmarks(365),
      getDailySummaries(60),
      getAccount().catch(() => null),
      getScoredPredictions(90),
    ]);
    const usage = getDetailedTokenUsage();
    const equity = account ? parseFloat(account.portfolio_value) : 0;
    const calibration = computeCalibration(scored);
    res.json({
      trades: computeTradeStats(outcomes),
      equity: computeEquityStats(benchmarks.map((b) => ({ date: b.date, equity: b.equity }))),
      aiCost: computeAICostStats({ todayUsd: usage.costUsd, dailyCosts: summaries, equity }),
      calibration: { n: calibration.n, hitRate: calibration.hitRate, meanBrier: calibration.meanBrier, byTrigger: calibration.byTrigger },
      gates: { minScoredForTuning: env.MIN_SCORED_FOR_TUNING, tuningLive: calibration.n >= env.MIN_SCORED_FOR_TUNING },
      models: usage.models,
      shortsEnabled: env.ENABLE_SHORTS,
      todayCalls: usage.calls,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/learning/ranking — the latest morning ranking snapshot
learningRouter.get('/ranking', async (req, res) => {
  try {
    res.json({ ranking: await getLatestRanking() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/learning/reflections?limit=14&type=nightly|weekly
learningRouter.get('/reflections', async (req, res) => {
  try {
    const limit = Math.min(60, parseInt(String(req.query.limit ?? '14'), 10) || 14);
    const type = req.query.type === 'nightly' || req.query.type === 'weekly' ? req.query.type : undefined;
    res.json({ reflections: await getRecentReflections(limit, type) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/learning/playbook — current playbook, tuned vs default rules, version history
learningRouter.get('/playbook', async (req, res) => {
  try {
    const playbook = getPlaybook();
    const defaults = getDefaultRules();
    const tuned = Object.keys(TUNABLE_BOUNDS).map((key) => ({
      key,
      value: (TRADING_RULES as unknown as Record<string, number>)[key],
      default: (defaults as unknown as Record<string, number>)[key],
      bounds: TUNABLE_BOUNDS[key as keyof typeof TUNABLE_BOUNDS],
    }));
    const versions = (await getPlaybookVersions(20)).map((v) => ({
      version: v.version,
      updatedBy: v.updatedBy,
      rationale: v.rationale,
      params: v.params,
      createdAt: v.createdAt,
      chars: v.strategyMd.length,
    }));
    res.json({ playbook, tuned, versions });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/learning/progress — equity vs SPY, calibration, recent predictions
learningRouter.get('/progress', async (req, res) => {
  try {
    const [benchmark, scored, recent] = await Promise.all([
      getBenchmarkComparison(90),
      getScoredPredictions(90),
      getRecentPredictions(40),
    ]);
    res.json({
      benchmark,
      calibration: computeCalibration(scored),
      predictions: recent.map((p) => ({
        id: String(p._id),
        symbol: p.symbol,
        createdAt: p.createdAt,
        dueAt: p.dueAt,
        status: p.status,
        acted: p.acted,
        action: p.action,
        trigger: p.trigger,
        direction: p.direction,
        expectedMovePct: p.expectedMovePct,
        horizonDays: p.horizonDays,
        confidence: p.confidence,
        conviction: p.conviction,
        entryPrice: p.entryPrice,
        thesis: p.thesis,
        outcome: p.outcome ?? null,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/learning/change-requests
learningRouter.get('/change-requests', async (req, res) => {
  try {
    res.json({ changeRequests: await getChangeRequests(undefined, 50) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
