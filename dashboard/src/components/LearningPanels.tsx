import { useCallback, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';

// ─── shared bits ─────────────────────────────────────────

function pct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n < 0 ? '' : '+'}${n.toFixed(digits)}%`;
}

function Tile({ label, value, hint, down }: { label: string; value: string; hint?: string; down?: boolean }) {
  return (
    <div className="tile flex flex-col gap-0.5">
      <div className="section-title">{label}</div>
      <div className={`text-2xl font-bold ${down ? 'text-[var(--crit)]' : ''}`}>{value}</div>
      {hint && <div className="chart-hint">{hint}</div>}
    </div>
  );
}

function VerdictTag({ verdict }: { verdict: string }) {
  const good = verdict === 'thesis_right';
  const bad = verdict === 'thesis_wrong';
  const cls = good
    ? 'bg-[rgba(63,185,80,0.16)] text-[var(--ok)]'
    : bad
      ? 'bg-[rgba(248,81,73,0.16)] text-[var(--crit)]'
      : 'bg-[var(--bg-hover)] text-[var(--muted)]';
  return <span className={`text-[0.62rem] font-bold tracking-[0.12em] uppercase px-1.5 py-0.5 rounded ${cls}`}>{verdict.replace(/_/g, ' ')}</span>;
}

function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Progress: equity vs SPY + calibration ───────────────

export function ProgressPanel() {
  const fetcher = useCallback(() => api.getLearningProgress(), []);
  const { data } = usePolling<any>(fetcher, 10 * 60 * 1000);
  if (!data) return <div className="tile text-[var(--muted)]">Loading progress…</div>;

  const b = data.benchmark;
  const cal = data.calibration;
  const series = (b?.series ?? []).map((r: any) => ({ date: r.date, bot: r.botIdx, spy: r.spyIdx }));
  const botDown = (b?.botReturnPct ?? 0) < 0;
  const alphaDown = (b?.alphaPct ?? 0) < 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label="Bot return" value={pct(b?.botReturnPct)} hint={b?.from ? `since ${fmtDate(b.from)}` : 'no sessions yet'} down={botDown} />
        <Tile label="SPY return" value={pct(b?.spyReturnPct)} hint="same window" down={(b?.spyReturnPct ?? 0) < 0} />
        <Tile label="Alpha" value={pct(b?.alphaPct)} hint="bot minus SPY" down={alphaDown} />
        <Tile
          label="Calibration"
          value={cal?.hitRate == null ? '—' : `${Math.round(cal.hitRate * 100)}% hit`}
          hint={cal?.n ? `n=${cal.n} · Brier ${cal.meanBrier?.toFixed(3)}` : 'no scored predictions yet'}
        />
      </div>

      <div className="tile">
        <div className="section-title mb-2">Equity vs SPY · indexed to 100</div>
        {series.length < 2 ? (
          <div className="chart-hint py-8 text-center">The benchmark line starts after the first end-of-day capture.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={fmtDate} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} domain={['auto', 'auto']} width={48} />
              <Tooltip contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--divider)', borderRadius: '0.6rem', fontSize: 12 }} />
              <ReferenceLine y={100} stroke="var(--muted)" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="bot" name="Bot" stroke={botDown ? 'var(--crit)' : 'var(--ok)'} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="spy" name="SPY" stroke="var(--info)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="tile">
          <div className="section-title mb-2">Stated confidence vs reality</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--accent)] text-[0.66rem] uppercase tracking-[0.14em]">
                <th className="text-left py-1 font-semibold">confidence</th>
                <th className="text-right py-1 font-semibold">n</th>
                <th className="text-right py-1 font-semibold">stated</th>
                <th className="text-right py-1 font-semibold">actual</th>
              </tr>
            </thead>
            <tbody>
              {(cal?.buckets ?? []).filter((x: any) => x.n > 0).map((x: any) => (
                <tr key={x.range} className="border-t border-[var(--divider)]">
                  <td className="py-1">{x.range}</td>
                  <td className="py-1 text-right">{x.n}</td>
                  <td className="py-1 text-right">{Math.round((x.meanConfidence ?? 0) * 100)}%</td>
                  <td className={`py-1 text-right font-semibold ${x.hitRate < x.meanConfidence - 0.1 ? 'text-[var(--crit)]' : ''}`}>{Math.round((x.hitRate ?? 0) * 100)}%</td>
                </tr>
              ))}
              {!(cal?.buckets ?? []).some((x: any) => x.n > 0) && (
                <tr><td colSpan={4} className="chart-hint py-3">Predictions are scored when their horizon elapses.</td></tr>
              )}
            </tbody>
          </table>
          <div className="chart-hint mt-2">
            Acted: {cal?.acted?.n ?? 0} ({cal?.acted?.hitRate == null ? '—' : Math.round(cal.acted.hitRate * 100) + '% hit'}) · Passed: {cal?.passed?.n ?? 0}, missed winners {cal?.passed?.missedWinners ?? 0}
          </div>
        </div>

        <div className="tile !p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--divider)]"><div className="section-title">Recent predictions</div></div>
          <div className="max-h-[300px] overflow-y-auto">
            {(data.predictions ?? []).length === 0 ? (
              <div className="chart-hint p-4">Every BUY and PASS decision leaves a prediction here.</div>
            ) : (
              (data.predictions as any[]).map((p) => (
                <div key={p.id} className="px-4 py-2 border-b border-[var(--divider)] text-sm flex items-baseline gap-3" title={p.thesis}>
                  <span className="font-bold w-14">{p.symbol}</span>
                  <span className={`text-[0.62rem] font-bold tracking-[0.12em] px-1.5 rounded ${p.acted ? 'bg-[rgba(126,196,111,0.16)] text-[var(--accent)]' : 'bg-[var(--bg-hover)] text-[var(--muted)]'}`}>{p.acted ? 'ACTED' : 'PASS'}</span>
                  <span className="text-[var(--text-secondary)]">{p.direction} {pct(p.expectedMovePct, 1)} / {p.horizonDays}d @ {Math.round(p.confidence * 100)}%</span>
                  <span className="ml-auto chart-hint">
                    {p.outcome ? (
                      <span className={p.outcome.directionHit ? 'text-[var(--ok)]' : 'text-[var(--crit)]'}>
                        {p.outcome.directionHit ? 'HIT' : 'MISS'} {pct(p.outcome.realizedMovePct, 1)}
                      </span>
                    ) : `due ${fmtDate(p.dueAt)}`}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Edge: the numbers a quant asks for first ───────────

function num(n: number | null | undefined, digits = 2, suffix = ''): string {
  if (n == null || !Number.isFinite(n)) return n === Infinity ? '∞' : '—';
  return `${n.toFixed(digits)}${suffix}`;
}

function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
}

export function EdgePanel() {
  const fetcher = useCallback(() => api.getLearningStats(), []);
  const { data } = usePolling<any>(fetcher, 10 * 60 * 1000);
  if (!data) return <div className="tile text-[var(--muted)]">Loading stats…</div>;

  const t = data.trades ?? {};
  const e = data.equity ?? {};
  const c = data.aiCost ?? {};
  const cal = data.calibration ?? {};
  const costPct = c.annualizedPctOfEquity;
  const costHigh = costPct != null && costPct > 1;

  const groups = (rec: Record<string, any> | undefined, label: string) => (
    <div className="tile">
      <div className="section-title mb-2">{label}</div>
      {!rec || Object.keys(rec).length === 0 ? (
        <div className="chart-hint">Nothing closed yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--accent)] text-[0.66rem] uppercase tracking-[0.14em]">
              <th className="text-left py-1 font-semibold">group</th>
              <th className="text-right py-1 font-semibold">n</th>
              <th className="text-right py-1 font-semibold">win</th>
              <th className="text-right py-1 font-semibold">avg</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(rec).map(([k, g]: [string, any]) => (
              <tr key={k} className="border-t border-[var(--divider)]">
                <td className="py-1">{k.replace(/_/g, ' ')}</td>
                <td className="py-1 text-right">{g.n}</td>
                <td className="py-1 text-right">{g.winRate == null ? '—' : Math.round(g.winRate * 100) + '%'}</td>
                <td className={`py-1 text-right font-semibold ${(g.avgPLPct ?? 0) < 0 ? 'text-[var(--crit)]' : ''}`}>{pct(g.avgPLPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label="Expectancy / trade" value={pct(t.expectancyPct)} hint={t.n ? `n=${t.n} closed · win ${Math.round((t.winRate ?? 0) * 100)}%` : 'no closed trades yet'} down={(t.expectancyPct ?? 0) < 0} />
        <Tile label="Profit factor" value={num(t.profitFactor)} hint={t.n ? `avg win ${pct(t.avgWinPct)} · avg loss ${pct(t.avgLossPct)}` : 'gross profit ÷ gross loss'} down={t.profitFactor != null && t.profitFactor < 1} />
        <Tile label="Sharpe (ann.)" value={num(e.sharpe)} hint={e.days ? `${e.days} sessions · daily vol ${num(e.dailyVolPct, 2, '%')}` : 'needs 5+ sessions'} down={e.sharpe != null && e.sharpe < 0} />
        <Tile label="Max drawdown" value={e.maxDrawdownPct == null ? '—' : `-${num(e.maxDrawdownPct, 2, '%')}`} hint={e.cagrPct != null ? `CAGR ${pct(e.cagrPct)}` : 'peak to trough'} down={(e.maxDrawdownPct ?? 0) > 5} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label="AI cost today" value={usd(c.todayUsd)} hint={`${data.todayCalls ?? 0} calls · ${data.models?.deep ?? ''}`} />
        <Tile label="AI cost / day" value={usd(c.avgPerTradingDayUsd)} hint={c.daysWithData ? `${c.daysWithData}-day average` : 'from tonight’s EOD summary'} />
        <Tile label="AI cost / equity" value={costPct == null ? '—' : `${num(costPct, 2, '%')} /yr`} hint={costHigh ? 'above 1%: AI spend is eating the edge' : 'annualized list price'} down={costHigh} />
        <Tile label="Tuning gate" value={data.gates?.tuningLive ? 'LIVE' : 'GATED'} hint={`${cal.n ?? 0} / ${data.gates?.minScoredForTuning ?? '?'} scored predictions`} down={!data.gates?.tuningLive} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {groups(t.byTrigger, 'By entry trigger')}
        {groups(t.byExitReason, 'By exit reason')}
        {groups(t.bySide, 'By side')}
      </div>
      <div className="chart-hint">
        Expectancy and profit factor need ~30+ closed trades before they mean anything. Until the tuning gate is live, the weekly review may propose parameter changes but they are not applied.
      </div>
    </div>
  );
}

// ─── Ranking: this morning's slate ───────────────────────

export function RankingPanel() {
  const fetcher = useCallback(() => api.getLatestRanking(), []);
  const { data } = usePolling<any>(fetcher, 10 * 60 * 1000);
  if (!data) return <div className="tile text-[var(--muted)]">Loading ranking…</div>;
  const r = data.ranking;
  if (!r) return <div className="tile chart-hint">No ranking yet — the morning cycle ranks the universe once at 9:35 ET.</div>;
  const rows = [...(r.candidates ?? [])].sort((a: any, b: any) => b.score - a.score);
  const regimeCls = r.regime === 'risk_on' ? 'text-[var(--ok)]' : r.regime === 'risk_off' ? 'text-[var(--crit)]' : 'text-[var(--warn)]';

  return (
    <div className="space-y-4">
      <div className="tile">
        <div className="flex items-baseline gap-3 mb-1">
          <div className="section-title">Ranking {r.date}</div>
          <span className={`text-[0.66rem] font-bold uppercase tracking-[0.14em] ${regimeCls}`}>{String(r.regime).replace('_', ' ')}</span>
          <span className="chart-hint">{r.universeSize} names · {r.modelUsed}</span>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">{r.marketRead}</p>
      </div>
      <div className="tile !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--accent)] text-[0.66rem] uppercase tracking-[0.14em] border-b border-[var(--divider)]">
                <th className="text-left p-3 font-semibold">symbol</th>
                <th className="text-right p-3 font-semibold">score</th>
                <th className="text-left p-3 font-semibold">side</th>
                <th className="text-right p-3 font-semibold">conv</th>
                <th className="text-right p-3 font-semibold">conf</th>
                <th className="text-right p-3 font-semibold">horizon</th>
                <th className="text-right p-3 font-semibold">stop / target</th>
                <th className="text-left p-3 font-semibold">thesis</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c: any) => (
                <tr key={c.symbol} className="border-b border-[var(--divider)]">
                  <td className="p-3 font-bold">{c.symbol}</td>
                  <td className={`p-3 text-right font-semibold ${c.score > 0 ? 'text-[var(--ok)]' : c.score < 0 ? 'text-[var(--crit)]' : 'text-[var(--muted)]'}`}>{c.score > 0 ? '+' : ''}{c.score}</td>
                  <td className="p-3">{c.side === 'none' ? <span className="chart-hint">—</span> : <span className={`text-[0.62rem] font-bold tracking-[0.12em] px-1.5 rounded ${c.side === 'long' ? 'bg-[rgba(63,185,80,0.16)] text-[var(--ok)]' : 'bg-[rgba(248,81,73,0.16)] text-[var(--crit)]'}`}>{c.side.toUpperCase()}</span>}</td>
                  <td className="p-3 text-right">{c.conviction}</td>
                  <td className="p-3 text-right">{Math.round(c.confidence * 100)}%</td>
                  <td className="p-3 text-right">{c.horizonDays}d</td>
                  <td className="p-3 text-right text-xs tabular-nums">{c.invalidationPrice != null ? `$${c.invalidationPrice}` : '—'} / {c.targetPrice != null ? `$${c.targetPrice}` : '—'}</td>
                  <td className="p-3 text-[var(--text-secondary)] max-w-[420px]" title={[...(c.catalysts ?? []), ...(c.risks ?? [])].join(' · ')}>{c.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Reflections ─────────────────────────────────────────

export function ReflectionsPanel() {
  const fetcher = useCallback(() => api.getReflections(14), []);
  const { data } = usePolling<any>(fetcher, 10 * 60 * 1000);
  const [open, setOpen] = useState<string | null>(null);
  const reflections: any[] = data?.reflections ?? [];

  if (!data) return <div className="tile text-[var(--muted)]">Loading reflections…</div>;
  if (reflections.length === 0) {
    return (
      <div className="tile">
        <div className="section-title mb-1">Reflections</div>
        <div className="chart-hint">The nightly post-mortem runs at 7:00 PM ET once predictions come due or trades close. The weekly review runs Sunday morning.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reflections.map((r) => {
        const id = String(r._id);
        const isOpen = open === id;
        return (
          <div key={id} className="tile">
            <button className="w-full text-left" onClick={() => setOpen(isOpen ? null : id)}>
              <div className="flex items-baseline gap-3">
                <span className={`text-[0.62rem] font-bold tracking-[0.12em] px-1.5 rounded ${r.type === 'weekly' ? 'badge-coral' : 'bg-[var(--bg-hover)] text-[var(--muted)]'}`}>{r.type.toUpperCase()}</span>
                <span className="chart-hint">{r.date}</span>
                <span className="font-semibold">{r.headline}</span>
                {r.playbookVersionAfter && <span className="ml-auto chart-hint">playbook → v{r.playbookVersionAfter}</span>}
              </div>
            </button>
            {isOpen && (
              <div className="mt-3 space-y-3 text-sm">
                <p className="text-[var(--text-secondary)] whitespace-pre-wrap">{r.summary}</p>
                {r.items?.length > 0 && (
                  <div className="space-y-2">
                    {r.items.map((it: any, i: number) => (
                      <div key={i} className="border-t border-[var(--divider)] pt-2">
                        <div className="flex items-center gap-2"><span className="font-bold">{it.symbol}</span><VerdictTag verdict={it.verdict} /><span className="chart-hint">{it.kind.replace('_', ' ')}</span></div>
                        <div className="text-[var(--text-secondary)] mt-1"><span className="text-[var(--accent)]">What happened:</span> {it.whatActuallyHappened}</div>
                        <div className="text-[var(--text-secondary)]"><span className="text-[var(--accent)]">What mattered:</span> {it.whatMattered}</div>
                        {it.lesson && it.lesson.toLowerCase() !== 'none' && <div className="text-[var(--text)]"><span className="text-[var(--accent)]">Lesson:</span> {it.lesson}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {r.patterns?.length > 0 && (
                  <div><div className="section-title mb-1">{r.type === 'weekly' ? 'Experiments next week' : 'Patterns'}</div><ul className="list-disc pl-5 text-[var(--text-secondary)]">{r.patterns.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul></div>
                )}
                {r.paramSuggestions?.length > 0 && (
                  <div><div className="section-title mb-1">{r.type === 'weekly' ? 'Parameter changes applied' : 'Parameter suggestions'}</div><ul className="list-disc pl-5 text-[var(--text-secondary)]">{r.paramSuggestions.map((p: any, i: number) => <li key={i}><span className="font-semibold">{p.key}</span> → {p.value} — {p.rationale}</li>)}</ul></div>
                )}
                {r.changeRequests?.length > 0 && (
                  <div><div className="section-title mb-1">Code change requests</div><ul className="list-disc pl-5 text-[var(--text-secondary)]">{r.changeRequests.map((c: any, i: number) => <li key={i}><span className="font-semibold">[{c.priority}] {c.title}</span> — {c.description}</li>)}</ul></div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Playbook ────────────────────────────────────────────

export function PlaybookPanel() {
  const fetcher = useCallback(() => api.getPlaybook(), []);
  const { data } = usePolling<any>(fetcher, 10 * 60 * 1000);
  if (!data?.playbook) return <div className="tile text-[var(--muted)]">Loading playbook…</div>;
  const pb = data.playbook;
  const tuned = (data.tuned ?? []).filter((t: any) => t.value !== t.default);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="tile lg:col-span-2">
        <div className="flex items-baseline gap-3 mb-2">
          <div className="section-title">Playbook v{pb.version}</div>
          <span className="chart-hint">updated {fmtDate(pb.updatedAt)} by {String(pb.updatedBy).replace('_', ' ')} — {pb.rationale}</span>
        </div>
        <pre className="whitespace-pre-wrap text-sm text-[var(--text-secondary)] font-[inherit] leading-relaxed">{pb.strategyMd}</pre>
      </div>
      <div className="space-y-4">
        <div className="tile">
          <div className="section-title mb-2">Tuned parameters</div>
          {tuned.length === 0 ? (
            <div className="chart-hint">All rules at env defaults. The weekly review may tune: {(data.tuned ?? []).map((t: any) => t.key).join(', ')}.</div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {tuned.map((t: any) => (
                  <tr key={t.key} className="border-t border-[var(--divider)]">
                    <td className="py-1">{t.key}</td>
                    <td className="py-1 text-right font-semibold">{t.value}</td>
                    <td className="py-1 text-right chart-hint">was {t.default}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="tile">
          <div className="section-title mb-2">Version history</div>
          <div className="space-y-1 text-sm max-h-[260px] overflow-y-auto">
            {(data.versions ?? []).map((v: any) => (
              <div key={v.version} className="border-t border-[var(--divider)] pt-1">
                <span className="font-semibold">v{v.version}</span> <span className="chart-hint">{fmtDate(v.createdAt)} · {String(v.updatedBy).replace('_', ' ')}</span>
                <div className="text-[var(--text-secondary)] text-xs">{v.rationale}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Changelog: self-made code changes ───────────────────

const STATUS_STYLE: Record<string, string> = {
  proposed: 'bg-[var(--bg-hover)] text-[var(--muted)]',
  in_progress: 'bg-[rgba(88,166,255,0.16)] text-[var(--info)]',
  awaiting_approval: 'badge-coral',
  merged: 'bg-[rgba(88,166,255,0.16)] text-[var(--info)]',
  deploying: 'bg-[rgba(210,153,34,0.16)] text-[var(--warn)]',
  deployed: 'bg-[rgba(63,185,80,0.16)] text-[var(--ok)]',
  rejected: 'bg-[var(--bg-hover)] text-[var(--muted)]',
  failed: 'bg-[rgba(248,81,73,0.16)] text-[var(--crit)]',
};

export function ChangelogPanel() {
  const fetcher = useCallback(() => api.getChangeRequests(), []);
  const { data, refresh } = usePolling<any>(fetcher, 60 * 1000);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const list: any[] = data?.changeRequests ?? [];

  const act = async (id: string, fn: (id: string) => Promise<any>) => {
    setBusy(id);
    try { await fn(id); } finally { setBusy(null); refresh(); }
  };

  return (
    <div className="space-y-4">
      <div className="tile">
        <div className="section-title mb-1">How code changes happen</div>
        <div className="chart-hint">
          The weekly review files change requests it cannot express in the playbook. The bot implements each one with Claude Code in a git worktree on the Pi, runs typecheck/tests/build, and auto-merges + deploys when only allowlisted files changed (paper mode). Anything touching risk, execution, env, hard limits, or deploy waits here for your approval. Once live money is on, everything waits.
        </div>
        <form
          className="mt-3 flex flex-col gap-2 md:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim() || !desc.trim()) return;
            await api.fileChangeRequest(title.trim(), desc.trim());
            setTitle(''); setDesc(''); refresh();
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="File a change request: title" className="bg-[var(--bg)] border border-[var(--divider)] rounded px-3 py-1.5 text-sm flex-[1]" />
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="what to change and why" className="bg-[var(--bg)] border border-[var(--divider)] rounded px-3 py-1.5 text-sm flex-[2]" />
          <button type="submit" className="px-3 py-1.5 text-[0.72rem] font-bold uppercase tracking-[0.18em] rounded bg-[var(--bg-hover)] text-[var(--text)] hover:text-[var(--accent)]">File</button>
        </form>
      </div>

      {list.length === 0 ? (
        <div className="tile chart-hint">No change requests yet.</div>
      ) : (
        list.map((cr) => {
          const id = String(cr._id);
          const isOpen = open === id;
          return (
            <div key={id} className="tile">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`text-[0.62rem] font-bold tracking-[0.12em] uppercase px-1.5 py-0.5 rounded ${STATUS_STYLE[cr.status] ?? ''}`}>{String(cr.status).replace(/_/g, ' ')}</span>
                <button className="font-semibold text-left" onClick={() => setOpen(isOpen ? null : id)}>{cr.title}</button>
                <span className="chart-hint">{cr.priority} · {cr.source.replace('_', ' ')} · {fmtDate(cr.createdAt)}</span>
                {cr.branch && <span className="chart-hint">{cr.branch}</span>}
                {cr.prUrl && <a className="chart-hint underline" href={cr.prUrl} target="_blank" rel="noreferrer">PR</a>}
                {cr.status === 'awaiting_approval' && (
                  <span className="ml-auto flex gap-2">
                    <button disabled={busy === id} onClick={() => act(id, api.approveChangeRequest)} className="px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] rounded bg-[rgba(63,185,80,0.16)] text-[var(--ok)]">Approve + deploy</button>
                    <button disabled={busy === id} onClick={() => act(id, api.rejectChangeRequest)} className="px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] rounded bg-[var(--bg-hover)] text-[var(--muted)]">Reject</button>
                  </span>
                )}
                {(cr.status === 'proposed' || cr.status === 'failed') && (
                  <span className="ml-auto flex gap-2">
                    {cr.status === 'proposed' && <button disabled={busy === id} onClick={() => act(id, () => api.runJob('self-improve'))} className="px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] rounded bg-[var(--bg-hover)] text-[var(--text)]">Run now</button>}
                    <button disabled={busy === id} onClick={() => act(id, api.rejectChangeRequest)} className="px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] rounded bg-[var(--bg-hover)] text-[var(--muted)]">Reject</button>
                  </span>
                )}
              </div>
              {isOpen && (
                <div className="mt-3 text-sm space-y-2">
                  <div className="text-[var(--text-secondary)]"><span className="text-[var(--accent)]">What:</span> {cr.description}</div>
                  <div className="text-[var(--text-secondary)]"><span className="text-[var(--accent)]">Why:</span> {cr.rationale}</div>
                  {cr.suggestedFiles?.length > 0 && <div className="chart-hint">Suggested files: {cr.suggestedFiles.join(', ')}</div>}
                  {cr.notes?.length > 0 && (
                    <pre className="whitespace-pre-wrap text-xs text-[var(--muted)] font-[inherit] bg-[var(--bg)] rounded p-3 max-h-[280px] overflow-y-auto">{cr.notes.slice(-8).join('\n')}</pre>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

export function LearningTab() {
  const [sub, setSub] = useState<'progress' | 'edge' | 'ranking' | 'reflections' | 'playbook' | 'changelog'>('progress');
  return (
    <div className="p-5 space-y-4 max-w-7xl mx-auto">
      <div className="flex gap-1">
        {(['progress', 'edge', 'ranking', 'reflections', 'playbook', 'changelog'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSub(s)}
            className={`px-4 py-1.5 text-[0.72rem] font-bold uppercase tracking-[0.18em] rounded transition-colors ${sub === s ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text-secondary)]'}`}
          >
            {s}
          </button>
        ))}
      </div>
      {sub === 'progress' && <ProgressPanel />}
      {sub === 'edge' && <EdgePanel />}
      {sub === 'ranking' && <RankingPanel />}
      {sub === 'reflections' && <ReflectionsPanel />}
      {sub === 'playbook' && <PlaybookPanel />}
      {sub === 'changelog' && <ChangelogPanel />}
    </div>
  );
}
