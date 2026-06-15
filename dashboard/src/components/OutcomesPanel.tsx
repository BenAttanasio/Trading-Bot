import type { OutcomesData, TradeOutcome } from '../types';

interface Props {
  data: OutcomesData | null;
}

const TRIGGER_LABELS: Record<string, string> = {
  morning_research: 'Morning Research',
  sentinel:         'Sentinel',
  portfolio_manager:'Portfolio Mgr',
  intraday_pulse:   'Intraday',
  eod:              'EOD',
  manual:           'Manual',
};

const EXIT_LABELS: Record<string, string> = {
  trailing_stop: 'Trailing Stop',
  ai_exit:       'AI Exit',
  ai_trim:       'AI Trim',
  manual:        'Manual',
};

const TRIGGER_COLORS: Record<string, string> = {
  morning_research: 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]',
  sentinel:         'bg-purple-500/20 text-purple-400',
  portfolio_manager:'bg-cyan-500/20 text-cyan-400',
  intraday_pulse:   'bg-[var(--accent-green)]/20 text-[var(--accent-green)]',
  eod:              'bg-gray-500/20 text-gray-400',
  manual:           'bg-gray-600/20 text-gray-400',
};

function pct(n: number, showSign = true) {
  const s = showSign && n >= 0 ? '+' : '';
  return `${s}${n.toFixed(2)}%`;
}

function winPct(n: number) { return `${(n * 100).toFixed(0)}%`; }

function TriggerBadge({ trigger }: { trigger: string }) {
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${TRIGGER_COLORS[trigger] ?? 'bg-gray-500/20 text-gray-400'}`}>
      {TRIGGER_LABELS[trigger] ?? trigger}
    </span>
  );
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: 'green' | 'red' | 'neutral' }) {
  const valueColor = highlight === 'green' ? 'text-[var(--accent-green)]' : highlight === 'red' ? 'text-[var(--accent-red)]' : '';
  return (
    <div className="bg-[var(--bg-card)] rounded-lg p-4 border border-[var(--border)] flex-1 min-w-0">
      <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-2xl font-bold ${valueColor}`}>{value}</div>
      {sub && <div className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</div>}
    </div>
  );
}

function OutcomeRow({ o }: { o: TradeOutcome }) {
  const win = o.realizedPLPercent > 0;
  const plColor = win ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]';

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-[var(--border)] last:border-0 text-sm">
      <span className="font-bold w-14 shrink-0">{o.symbol}</span>
      <TriggerBadge trigger={o.entryTrigger} />
      <span className={`font-semibold tabular-nums shrink-0 ${plColor}`}>{pct(o.realizedPLPercent)}</span>
      <span className="text-[var(--text-muted)] text-xs shrink-0">{o.daysHeld}d</span>
      <span className="text-[var(--text-muted)] text-xs ml-auto shrink-0">{EXIT_LABELS[o.exitReason] ?? o.exitReason}</span>
      {o.aiConviction > 0 && (
        <span className="text-[var(--text-muted)] text-xs shrink-0 w-8 text-right">C{o.aiConviction}</span>
      )}
    </div>
  );
}

function EmptyJournal() {
  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] p-12 text-center space-y-3">
      <div className="text-4xl">📒</div>
      <div className="text-[var(--text-secondary)] font-medium">No closed trades yet</div>
      <div className="text-[var(--text-muted)] text-sm max-w-sm mx-auto">
        The journal fills automatically when the bot closes a position — whether by trailing stop, AI decision, or partial trim.
      </div>
      <div className="text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border)] mt-4 max-w-sm mx-auto">
        Once you have trades, you'll see win rate by trigger source (Morning Research vs Sentinel vs Portfolio Manager), conviction level, and average holding period.
      </div>
    </div>
  );
}

export function OutcomesPanel({ data }: Props) {
  if (!data || data.stats.totalTrades === 0) {
    return <EmptyJournal />;
  }

  const { outcomes, stats } = data;
  const recent = outcomes.slice(0, 20);
  const triggerRows = Object.entries(stats.byTrigger).sort((a, b) => b[1].count - a[1].count);
  const plHighlight = stats.avgPLPercent >= 0 ? 'green' : 'red';

  return (
    <div className="space-y-4">
      {/* ── Top stat cards ── */}
      <div className="flex gap-4">
        <StatCard
          label="Win Rate"
          value={winPct(stats.winRate)}
          sub={`${stats.totalTrades} closed trades`}
          highlight={stats.winRate >= 0.5 ? 'green' : 'red'}
        />
        <StatCard
          label="Avg P&L per Trade"
          value={pct(stats.avgPLPercent)}
          highlight={plHighlight}
        />
        <StatCard
          label="Avg Holding Period"
          value={stats.avgDaysHeld > 0 ? `${stats.avgDaysHeld.toFixed(1)}d` : '—'}
          sub="days per position"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── By trigger ── */}
        <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide font-semibold mb-3">
            Performance by Entry Trigger
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="text-left pb-2">Trigger</th>
                <th className="text-right pb-2">Trades</th>
                <th className="text-right pb-2">Win Rate</th>
                <th className="text-right pb-2">Avg P&L</th>
              </tr>
            </thead>
            <tbody>
              {triggerRows.map(([trigger, s]) => (
                <tr key={trigger} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-2"><TriggerBadge trigger={trigger} /></td>
                  <td className="text-right text-[var(--text-secondary)] tabular-nums">{s.count}</td>
                  <td className="text-right tabular-nums text-[var(--text-secondary)]">{winPct(s.winRate)}</td>
                  <td className={`text-right font-semibold tabular-nums ${s.avgPL >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                    {pct(s.avgPL)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── By conviction ── */}
        <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide font-semibold mb-3">
            Performance by AI Conviction Score
          </div>
          <div className="space-y-3">
            {(['high', 'mid', 'low'] as const).map((key) => {
              const c = stats.byConviction[key];
              const barWidth = c.count > 0 ? Math.round(c.winRate * 100) : 0;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--text-secondary)] font-medium capitalize">
                      {key} conviction <span className="text-[var(--text-muted)]">({c.range})</span>
                    </span>
                    <span className="text-[var(--text-muted)]">
                      {c.count > 0 ? `${winPct(c.winRate)} win · ${c.count} trades` : 'No trades'}
                    </span>
                  </div>
                  <div className="h-1.5 bg-[var(--bg-hover)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--accent-blue)] rounded-full transition-all"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Recent closed trades ── */}
      <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] p-4">
        <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide font-semibold mb-1">
          Recent Closed Trades
        </div>
        <div className="text-xs text-[var(--text-muted)] mb-3">Last {recent.length} exits — click a symbol to see the original thesis</div>
        <div className="max-h-72 overflow-y-auto">
          {recent.map((o, i) => <OutcomeRow key={i} o={o} />)}
        </div>
      </div>
    </div>
  );
}
