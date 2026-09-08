import { ObjectId } from 'mongodb';
import { callAIStructured, MODEL_IDS, WEB_RESEARCH_TOOLS, getDailyTokenUsage } from '../services/ai/client';
import { NightlyReflectionSchema, WeeklyReviewSchema } from '../services/ai/schemas';
import {
  REFLECTION_SYSTEM_PROMPT,
  WEEKLY_REVIEW_SYSTEM_PROMPT,
  buildNightlyReflectionPrompt,
  buildWeeklyReviewPrompt,
} from '../services/ai/prompts/reflection';
import { getPlaybookBlock, appendLessons, updatePlaybook, getPlaybook } from '../services/playbook';
import {
  getPredictionsScoredSince,
  getScoredPredictions,
  insertReflection,
  attachVerdict,
  getReflectionsSince,
  insertChangeRequest,
} from '../services/db/learning-queries';
import { getRecentOutcomes, getDecisionsToday, getAllPositions } from '../services/db/queries';
import { getAccount } from '../services/alpaca/client';
import { Reflection, ChangeRequest } from '../services/db/models/reflection';
import { scoreDuePredictions, computeCalibration } from './predictions';
import { getBenchmarkComparison } from './benchmark';
import { getETDateISO, getStartOfETDay } from '../utils/time';
import { env } from '../config/env';
import { createServiceLogger } from '../utils/logger';
import { notify } from '../services/notify';

const log = createServiceLogger('Reflection');

let running = false;

/**
 * Nightly post-mortem (Sonnet 5): score due predictions, pair closed trades with
 * their theses, ask for verdicts + lessons, and append up to 3 lessons to the
 * playbook. One LLM call per night; skipped when there is nothing to judge.
 */
export async function runNightlyReflection(): Promise<Reflection | null> {
  if (running) {
    log.warn('Reflection already running — skipped');
    return null;
  }
  running = true;
  const date = getETDateISO();
  try {
    log.info('═══ NIGHTLY REFLECTION ═══');
    await scoreDuePredictions();

    const startOfDay = getStartOfETDay();
    const [scoredToday, allOutcomes, decisionsToday, account] = await Promise.all([
      getPredictionsScoredSince(startOfDay),
      getRecentOutcomes(100),
      getDecisionsToday(),
      getAccount().catch(() => null),
    ]);
    const closedToday = allOutcomes.filter((o) => new Date(o.createdAt) >= startOfDay);

    if (scoredToday.length === 0 && closedToday.length === 0) {
      log.info('Nothing came due and nothing closed today — no reflection needed');
      return null;
    }

    const calibration = computeCalibration(await getScoredPredictions(90));
    const lastEquity = account ? parseFloat(account.last_equity) : 0;
    const dailyPLPercent = account && lastEquity > 0 ? ((parseFloat(account.portfolio_value) - lastEquity) / lastEquity) * 100 : null;

    const parsed = await callAIStructured({
      schema: NightlyReflectionSchema,
      systemPrompt: REFLECTION_SYSTEM_PROMPT,
      cachedBlocks: [getPlaybookBlock()],
      userPrompt: buildNightlyReflectionPrompt({
        date,
        scored: scoredToday,
        closed: closedToday,
        calibration,
        todayStats: {
          tradesExecuted: decisionsToday.filter((d) => d.executed).length,
          tradesBlocked: decisionsToday.filter((d) => d.decision === 'BLOCKED').length,
          dailyPLPercent,
        },
      }),
      model: 'fast',
      effort: 'medium',
      maxTokens: 8192,
      purpose: 'nightly-reflection',
    });

    const reflection: Reflection = {
      type: 'nightly',
      date,
      headline: parsed.headline,
      summary: parsed.summary,
      items: parsed.items,
      patterns: parsed.patterns,
      playbookSuggestions: parsed.playbookSuggestions,
      paramSuggestions: parsed.paramSuggestions,
      playbookVersionAfter: null,
      stats: {
        scored: scoredToday.length,
        closed: closedToday.length,
        hitRate: calibration.hitRate,
        meanBrier: calibration.meanBrier,
      },
      modelUsed: MODEL_IDS.fast,
      createdAt: new Date(),
    };
    const reflectionId = await insertReflection(reflection);

    for (const item of parsed.items) {
      if (item.kind !== 'prediction' || !ObjectId.isValid(item.refId)) continue;
      await attachVerdict(new ObjectId(item.refId), item.verdict, item.lesson, reflectionId).catch((err) =>
        log.warn(`Could not attach verdict for ${item.symbol}`, { err })
      );
    }

    const lessons = parsed.lessonsToAppend.filter((l) => l && l.toLowerCase() !== 'none').slice(0, 3);
    if (lessons.length) {
      const pb = await appendLessons(lessons, 'nightly_reflection', `Nightly reflection ${date}: ${parsed.headline}`);
      reflection.playbookVersionAfter = pb?.version ?? null;
    }

    await notify(`Nightly reflection ${date}`, `${parsed.headline}
${parsed.summary.slice(0, 600)}`, 'info');
    log.info(`Nightly reflection stored: ${parsed.headline}`, {
      items: parsed.items.length,
      lessonsAppended: lessons.length,
      paramSuggestions: parsed.paramSuggestions.length,
    });
    return { ...reflection, _id: reflectionId };
  } catch (error) {
    log.error('Nightly reflection failed', { error });
    return null;
  } finally {
    running = false;
  }
}

/**
 * Weekly deep review (Opus 5 + web search): consolidates the week's reflections
 * into a rewritten playbook, applies parameter changes, and files change
 * requests for anything that needs code.
 */
export async function runWeeklyReview(): Promise<Reflection | null> {
  if (running) {
    log.warn('Reflection already running — weekly review skipped');
    return null;
  }
  running = true;
  const today = getETDateISO();
  try {
    log.info('═══ WEEKLY DEEP REVIEW ═══');
    await scoreDuePredictions();

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [reflections, scored, outcomesAll, benchmark, positions] = await Promise.all([
      getReflectionsSince(weekAgo),
      getScoredPredictions(90),
      getRecentOutcomes(200),
      getBenchmarkComparison(30),
      getAllPositions(),
    ]);
    const outcomes = outcomesAll.filter((o) => new Date(o.createdAt) >= monthAgo);

    if (reflections.length === 0 && outcomes.length === 0 && scored.length === 0) {
      log.info('No reflections, outcomes, or scored predictions yet — weekly review skipped');
      return null;
    }

    const calibration = computeCalibration(scored);
    const usage = getDailyTokenUsage();
    // Sample-size gate: with too few scored predictions, parameter changes and code
    // change requests are noise. The review still consolidates the playbook text.
    const tuningGated = calibration.n < env.MIN_SCORED_FOR_TUNING;

    const parsed = await callAIStructured({
      schema: WeeklyReviewSchema,
      systemPrompt: WEEKLY_REVIEW_SYSTEM_PROMPT,
      cachedBlocks: [getPlaybookBlock()],
      userPrompt: buildWeeklyReviewPrompt({
        weekStart: weekAgo.toISOString().slice(0, 10),
        weekEnd: today,
        reflections,
        calibration,
        outcomes,
        benchmark: { botReturnPct: benchmark.botReturnPct, spyReturnPct: benchmark.spyReturnPct, from: benchmark.from, to: benchmark.to },
        openPositions: positions.map((p) => ({ symbol: p.symbol, plPercent: p.unrealizedPLPercent, daysHeld: p.daysHeld, thesis: p.thesis })),
        tokenSpend: { total: usage.total, budget: usage.budget },
        sampleGate: { minScored: env.MIN_SCORED_FOR_TUNING, gated: tuningGated },
      }),
      model: 'deep',
      effort: 'high',
      maxTokens: 16000,
      tools: WEB_RESEARCH_TOOLS,
      maxToolRounds: 6,
      purpose: 'weekly-review',
    });

    if (tuningGated && (parsed.paramChanges.length || parsed.changeRequests.length)) {
      log.warn(`Weekly review proposed ${parsed.paramChanges.length} param changes and ${parsed.changeRequests.length} change requests, but only ${calibration.n}/${env.MIN_SCORED_FOR_TUNING} predictions are scored — not applied`);
    }
    const paramChanges = tuningGated ? [] : parsed.paramChanges;
    const changeRequests = tuningGated ? [] : parsed.changeRequests;

    // Apply: playbook text + params (clamped inside updatePlaybook)
    const params = Object.fromEntries(paramChanges.map((c) => [c.key, c.value]));
    const before = getPlaybook()?.version ?? null;
    const pb = await updatePlaybook({
      strategyMd: parsed.newStrategyMd,
      params,
      updatedBy: 'weekly_review',
      rationale: `Weekly review ${today}: ${parsed.headline}`,
    });

    const reflection: Reflection = {
      type: 'weekly',
      date: today,
      headline: parsed.headline,
      summary: `${parsed.assessment}\n\nVs benchmark: ${parsed.performanceVsBenchmark}\n\nCalibration: ${parsed.calibrationNotes}`,
      items: [],
      patterns: parsed.experimentsNextWeek,
      playbookSuggestions: [],
      paramSuggestions: paramChanges,
      changeRequests,
      playbookVersionAfter: pb.version,
      stats: {
        playbookVersionBefore: before,
        botReturnPct: benchmark.botReturnPct,
        spyReturnPct: benchmark.spyReturnPct,
        hitRate: calibration.hitRate,
        meanBrier: calibration.meanBrier,
        confidence: parsed.confidence,
        scoredN: calibration.n,
        tuningGated,
        proposedButGated: tuningGated ? { paramChanges: parsed.paramChanges, changeRequests: parsed.changeRequests } : undefined,
      },
      modelUsed: MODEL_IDS.deep,
      createdAt: new Date(),
    };
    const reflectionId = await insertReflection(reflection);

    for (const cr of changeRequests) {
      const doc: ChangeRequest = {
        ...cr,
        status: 'proposed',
        source: 'weekly_review',
        reflectionId,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: [],
      };
      await insertChangeRequest(doc);
    }

    await notify(`Weekly review ${today}`, `${parsed.headline}
Playbook → v${pb.version}; ${paramChanges.length} param changes; ${changeRequests.length} change requests${tuningGated ? ` (tuning gated: ${calibration.n}/${env.MIN_SCORED_FOR_TUNING} scored)` : ''}.`, 'info');
    log.info(`Weekly review stored: ${parsed.headline}`, {
      playbookVersion: pb.version,
      paramChanges,
      changeRequests: changeRequests.length,
      tuningGated,
    });
    return { ...reflection, _id: reflectionId };
  } catch (error) {
    log.error('Weekly review failed', { error });
    return null;
  } finally {
    running = false;
  }
}
