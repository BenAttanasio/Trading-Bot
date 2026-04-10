interface PortfolioSummaryProps {
  value: number;
  cash: number;
  invested: number;
  dailyPL: number;
  dailyPLPercent: number;
  positionCount: number;
  todayStats: {
    tradesExecuted: number;
    tradesBlocked: number;
    alertsToday: number;
  };
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function formatPct(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function PortfolioSummary({ value, cash, invested, dailyPL, dailyPLPercent, positionCount, todayStats }: PortfolioSummaryProps) {
  const plColor = dailyPL >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]';

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* Portfolio Value */}
      <div className="bg-[var(--bg-card)] rounded-lg p-4 border border-[var(--border)]">
        <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-1">Portfolio Value</div>
        <div className="text-2xl font-bold">{formatCurrency(value)}</div>
        <div className={`text-sm ${plColor}`}>
          {dailyPL >= 0 ? '+' : ''}{formatCurrency(dailyPL)} ({formatPct(dailyPLPercent)})
        </div>
      </div>

      {/* Cash / Invested */}
      <div className="bg-[var(--bg-card)] rounded-lg p-4 border border-[var(--border)]">
        <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-1">Allocation</div>
        <div className="text-lg font-semibold">{formatCurrency(invested)} <span className="text-sm text-[var(--text-secondary)]">invested</span></div>
        <div className="text-sm text-[var(--text-secondary)]">{formatCurrency(cash)} cash</div>
      </div>

      {/* Positions */}
      <div className="bg-[var(--bg-card)] rounded-lg p-4 border border-[var(--border)]">
        <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-1">Positions</div>
        <div className="text-2xl font-bold">{positionCount}</div>
        <div className="text-sm text-[var(--text-secondary)]">{todayStats.tradesExecuted} trades today</div>
      </div>

      {/* Activity */}
      <div className="bg-[var(--bg-card)] rounded-lg p-4 border border-[var(--border)]">
        <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-1">Today's Activity</div>
        <div className="flex flex-wrap gap-3 mt-1">
          <div>
            <span className="text-lg font-bold text-[var(--accent-blue)]">{todayStats.tradesExecuted}</span>
            <span className="text-xs text-[var(--text-muted)] ml-1">trades</span>
          </div>
          <div>
            <span className="text-lg font-bold text-[var(--accent-red)]">{todayStats.tradesBlocked}</span>
            <span className="text-xs text-[var(--text-muted)] ml-1">blocked</span>
          </div>
          <div>
            <span className="text-lg font-bold text-[var(--accent-yellow)]">{todayStats.alertsToday}</span>
            <span className="text-xs text-[var(--text-muted)] ml-1">alerts</span>
          </div>
        </div>
      </div>
    </div>
  );
}
