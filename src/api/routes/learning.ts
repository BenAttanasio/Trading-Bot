import { Router } from 'express';
import { getRecentReflections, getScoredPredictions, getRecentPredictions, getChangeRequests } from '../../services/db/learning-queries';
import { getPlaybook, getPlaybookVersions } from '../../services/playbook';
import { computeCalibration } from '../../engine/predictions';
import { getBenchmarkComparison } from '../../engine/benchmark';
import { TUNABLE_BOUNDS } from '../../config/hard-limits';
import { TRADING_RULES, getDefaultRules } from '../../config/trading-rules';

export const learningRouter = Router();

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
