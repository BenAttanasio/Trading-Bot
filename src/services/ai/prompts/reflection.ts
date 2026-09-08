import { Prediction } from '../../db/models/prediction';
import { TradeOutcome } from '../../db/models/trade-outcome';
import { Reflection } from '../../db/models/reflection';
import { CalibrationReport } from '../../../engine/predictions';
import { TUNABLE_BOUNDS } from '../../../config/hard-limits';

const VERDICT_GUIDE = `Verdict categories:
- thesis_right: the stated catalyst played out and price moved as predicted.
- thesis_wrong: the catalyst did not play out, or the read of it was wrong.
- right_for_wrong_reason: price moved as predicted but for a different reason than the thesis.
- timing: the thesis was sound but the horizon/entry was off.
- unclear: not enough information to judge honestly.
Separate luck from skill. A profitable trade with a wrong thesis is thesis_wrong or right_for_wrong_reason, not thesis_right.`;

export const REFLECTION_SYSTEM_PROMPT = `You are the reviewer for a small autonomous trading desk. Every evening you audit the desk's predictions and closed trades against what actually happened. You are honest, specific, and allergic to hindsight bias: judge decisions by the information available at the time, then say what the information actually implied.

${VERDICT_GUIDE}

Tunable parameter keys (only these may appear in paramSuggestions, values are clamped to bounds): ${Object.entries(TUNABLE_BOUNDS).map(([k, b]) => `${k} [${b.min}-${b.max}]`).join(', ')}.

Lessons must be generalizable rules of the form "when X, do Y because Z", not restatements of a single outcome.`;

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function buildNightlyReflectionPrompt(params: {
  date: string;
  scored: Prediction[];
  closed: TradeOutcome[];
  calibration: CalibrationReport;
  todayStats: { tradesExecuted: number; tradesBlocked: number; dailyPLPercent: number | null };
}): string {
  const { date, scored, closed, calibration, todayStats } = params;

  const predBlock = scored
    .map((p) => {
      const o = p.outcome!;
      const news = p.context.news.slice(0, 6).map((n) => `      - [${n.date}] ${n.headline}`).join('\n');
      return `  PREDICTION id=${p._id} ${p.symbol} (${p.acted ? 'ACTED — ' + p.action : 'PASSED'}, trigger=${p.trigger}, model=${p.modelUsed})
    Made ${p.createdAt.toISOString().slice(0, 10)} at $${p.entryPrice.toFixed(2)}: ${p.direction} ${fmtPct(p.expectedMovePct)} over ${p.horizonDays}d, confidence ${p.confidence.toFixed(2)}, conviction ${p.conviction}/10
    Thesis: ${p.thesis}
    Catalysts cited: ${p.catalysts.join('; ') || 'none'}
    Invalidation stated: ${p.invalidation}
    Indicators at decision: RSI ${p.context.indicators.rsi?.toFixed(1) ?? 'n/a'}, SMA20 ${p.context.indicators.sma20?.toFixed(2) ?? 'n/a'}, vol ${p.context.indicators.volumeVsAvg?.toFixed(1) ?? 'n/a'}x, 5d ${fmtPct(p.context.indicators.priceChange5d)}
    News cited at decision:
${news || '      (none)'}
    OUTCOME at due date: $${o.priceAtDue.toFixed(2)} → ${fmtPct(o.realizedMovePct)} (${o.directionHit ? 'direction HIT' : 'direction MISS'}, brier ${o.brier.toFixed(3)}); max favorable ${fmtPct(o.maxFavorablePct)}, max adverse ${fmtPct(o.maxAdversePct)}`;
    })
    .join('\n\n');

  const closedBlock = closed
    .map(
      (t) => `  CLOSED_TRADE id=${t._id} ${t.symbol}: entry $${t.entryPrice.toFixed(2)} (${t.entryDate.toISOString().slice(0, 10)}, trigger=${t.entryTrigger}) → exit $${t.exitPrice.toFixed(2)} (${t.exitDate.toISOString().slice(0, 10)}, ${t.exitReason}), held ${t.daysHeld}d, P&L ${fmtPct(t.realizedPLPercent)} ($${t.realizedPLDollars.toFixed(2)})
    Original thesis: ${t.originalThesis}
    Thesis freshness at exit: ${t.thesisFreshness}`
    )
    .join('\n\n');

  const cal = `Overall (last 90d, n=${calibration.n}): direction hit rate ${calibration.hitRate == null ? 'n/a' : (calibration.hitRate * 100).toFixed(0) + '%'}, mean Brier ${calibration.meanBrier?.toFixed(3) ?? 'n/a'}
Buckets: ${calibration.buckets.filter((b) => b.n > 0).map((b) => `${b.range}: n=${b.n} hit=${((b.hitRate ?? 0) * 100).toFixed(0)}% (stated ${((b.meanConfidence ?? 0) * 100).toFixed(0)}%)`).join(' | ') || 'none yet'}
Acted: n=${calibration.acted.n} hit=${calibration.acted.hitRate == null ? 'n/a' : (calibration.acted.hitRate * 100).toFixed(0) + '%'} avg move ${fmtPct(calibration.acted.avgMovePct)} | Passed: n=${calibration.passed.n} avg move ${fmtPct(calibration.passed.avgMovePct)}, missed winners (>=3%) ${calibration.passed.missedWinners}`;

  return `NIGHTLY POST-MORTEM — ${date}

TODAY: ${todayStats.tradesExecuted} trades executed, ${todayStats.tradesBlocked} blocked by risk manager, day P&L ${fmtPct(todayStats.dailyPLPercent)}.

PREDICTIONS THAT CAME DUE TODAY (${scored.length}):
${predBlock || '  (none)'}

TRADES CLOSED TODAY (${closed.length}):
${closedBlock || '  (none)'}

CALIBRATION CONTEXT:
${cal}

For every item above, give a verdict, say what actually happened and which cited input actually mattered (or what we missed), and extract a lesson if there is one. Then list cross-item patterns, any playbook rule suggestions with evidence, any parameter suggestions, and 0-3 lessons crisp enough to append to the playbook tonight.`;
}

export const WEEKLY_REVIEW_SYSTEM_PROMPT = `You are the head of research for a small autonomous trading desk, doing the Sunday deep review. You have web search and web fetch: use them to find out what actually drove the week's biggest misses and hits (earnings details, guidance, macro events, sector moves), and to check whether the desk's cited catalysts were real. Cite what you find in the assessment.

Your outputs change how the desk trades next week:
- newStrategyMd REPLACES the playbook. Keep the section headings. Turn validated "Recent lessons" into rules under the right heading and delete the rest. Keep "Known mistakes" honest and specific. Stay under 4000 characters. Never contradict the hard limits (they are enforced in code anyway).
- paramChanges are applied immediately (clamped to bounds). Propose a change only with evidence; prefer small moves.
- changeRequests are for things the playbook cannot express (a new indicator, a data source, a bug). Be concrete: what, where, why. Most weeks this is empty.

${VERDICT_GUIDE}

Tunable parameter keys and bounds: ${Object.entries(TUNABLE_BOUNDS).map(([k, b]) => `${k} [${b.min}-${b.max}]`).join(', ')}.`;

export function buildWeeklyReviewPrompt(params: {
  weekStart: string;
  weekEnd: string;
  reflections: Reflection[];
  calibration: CalibrationReport;
  outcomes: TradeOutcome[];
  benchmark: { botReturnPct: number | null; spyReturnPct: number | null; from: string | null; to: string | null };
  openPositions: Array<{ symbol: string; plPercent: number; daysHeld: number; thesis: string }>;
  tokenSpend: { total: number; budget: number };
  sampleGate?: { minScored: number; gated: boolean };
}): string {
  const { weekStart, weekEnd, reflections, calibration, outcomes, benchmark, openPositions, tokenSpend, sampleGate } = params;
  const gateNote = sampleGate
    ? sampleGate.gated
      ? `\nSAMPLE SIZE: only ${calibration.n} scored predictions (need ${sampleGate.minScored}). Parameter changes and change requests will NOT be applied this week — you may still list them as proposals. Do not promote "Recent lessons" into rules on this little evidence; keep them as lessons.`
      : `\nSAMPLE SIZE: ${calibration.n} scored predictions (>= ${sampleGate.minScored}); tuning is live this week. Still prefer small moves.`
    : '';

  const nightly = reflections
    .filter((r) => r.type === 'nightly')
    .map((r) => {
      const items = r.items
        .map((i) => `      - ${i.symbol} [${i.kind}] ${i.verdict}: ${i.whatMattered} → ${i.lesson}`)
        .join('\n');
      return `  ${r.date}: ${r.headline}\n    ${r.summary}\n    Patterns: ${r.patterns.join('; ') || 'none'}\n${items}`;
    })
    .join('\n\n');

  const wins = outcomes.filter((o) => o.realizedPLPercent > 0);
  const outcomeStats = outcomes.length
    ? `n=${outcomes.length}, win rate ${((wins.length / outcomes.length) * 100).toFixed(0)}%, avg P&L ${fmtPct(outcomes.reduce((s, o) => s + o.realizedPLPercent, 0) / outcomes.length)}, avg hold ${(outcomes.reduce((s, o) => s + o.daysHeld, 0) / outcomes.length).toFixed(1)}d, by exit reason: ${Object.entries(
        outcomes.reduce<Record<string, number>>((acc, o) => ((acc[o.exitReason] = (acc[o.exitReason] ?? 0) + 1), acc), {})
      )
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`
    : 'no closed trades';

  const worst = [...outcomes].sort((a, b) => a.realizedPLPercent - b.realizedPLPercent).slice(0, 3);
  const best = [...outcomes].sort((a, b) => b.realizedPLPercent - a.realizedPLPercent).slice(0, 3);
  const fmtTrade = (t: TradeOutcome) => `${t.symbol} ${fmtPct(t.realizedPLPercent)} (${t.entryDate.toISOString().slice(0, 10)}→${t.exitDate.toISOString().slice(0, 10)}, ${t.exitReason}): ${t.originalThesis.slice(0, 200)}`;

  return `WEEKLY DEEP REVIEW — ${weekStart} to ${weekEnd}

PERFORMANCE: bot ${fmtPct(benchmark.botReturnPct)} vs SPY ${fmtPct(benchmark.spyReturnPct)} (${benchmark.from ?? '?'} → ${benchmark.to ?? '?'}). AI spend today: ${tokenSpend.total.toLocaleString()} / ${tokenSpend.budget.toLocaleString()} budget tokens.${gateNote}

CLOSED TRADES (30d): ${outcomeStats}
  Worst: ${worst.map(fmtTrade).join(' || ') || 'none'}
  Best: ${best.map(fmtTrade).join(' || ') || 'none'}

OPEN POSITIONS: ${openPositions.map((p) => `${p.symbol} ${fmtPct(p.plPercent)} ${p.daysHeld}d — ${p.thesis.slice(0, 120)}`).join(' || ') || 'none'}

CALIBRATION (90d): n=${calibration.n}, hit ${calibration.hitRate == null ? 'n/a' : (calibration.hitRate * 100).toFixed(0) + '%'}, Brier ${calibration.meanBrier?.toFixed(3) ?? 'n/a'}
  Buckets: ${calibration.buckets.filter((b) => b.n > 0).map((b) => `${b.range}: n=${b.n} hit=${((b.hitRate ?? 0) * 100).toFixed(0)}% stated=${((b.meanConfidence ?? 0) * 100).toFixed(0)}%`).join(' | ') || 'none'}
  By trigger: ${Object.entries(calibration.byTrigger).map(([k, v]) => `${k}: n=${v.n} hit=${(v.hitRate * 100).toFixed(0)}%`).join(' | ') || 'none'}
  Acted vs passed: acted n=${calibration.acted.n} hit=${calibration.acted.hitRate == null ? 'n/a' : (calibration.acted.hitRate * 100).toFixed(0) + '%'}; passed n=${calibration.passed.n} avg move ${fmtPct(calibration.passed.avgMovePct)}, missed winners ${calibration.passed.missedWinners}

NIGHTLY REFLECTIONS THIS WEEK:
${nightly || '  (none — quiet week or the desk was paused)'}

The current playbook is in your system context. Research the biggest misses and hits, then produce the assessment, the revised playbook, parameter changes with evidence, any code change requests, and next week's experiments.`;
}
