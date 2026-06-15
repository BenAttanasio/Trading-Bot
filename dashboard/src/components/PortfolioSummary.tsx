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

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg-card)] rounded-lg p-4 border border-[var(--border)]">
      <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-2">{label}</div>
      {children}
    </div>
  );
}

export function PortfolioSummary({ value, cash, invested, dailyPL, dailyPLPercent, positionCount, todayStats }: PortfolioSummaryProps) {
  const plPositive = dailyPL >= 0;
  const plColor = plPositive ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]';
  const exposure = value > 0 ? (invested / value) * 100 : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Portfolio Value */}
      <Card label="Portfolio Value">
        <div className="text-2xl font-bold tabular-nums">{formatCurrency(value)}</div>
        <div className={`text-sm font-semibold mt-0.5 ${plColor}`}>
          {plPositive ? '+' : ''}{formatCurrency(dailyPL)}{' '}
          <span className="text-xs opacity-80">({plPositive ? '+' : ''}{dailyPLPercent.toFixed(2)}%)</span>
        </div>
        <div className="text-xs text-[var(--text-muted)] mt-0.5">today's P&L</div>
      </Card>

      {/* Allocation */}
      <Card label="Allocation">
        <div className="text-xl font-bold tabular-nums">{formatCurrency(invested)}</div>
        <div className="text-sm text-[var(--text-secondary)]">{formatCurrency(cash)} cash</div>
        {/* Exposure bar */}
        <div className="mt-2 h-1.5 bg-[var(--bg-hover)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--accent-blue)] rounded-full"
            style={{ width: `${Math.min(100, exposure)}%` }}
          />
        </div>
        <div className="text-xs text-[var(--text-muted)] mt-1">{exposure.toFixed(0)}% deployed</div>
      </Card>

      {/* Positions */}
      <Card label="Open Positions">
        <div className="text-3xl font-bold">{positionCount}</div>
        <div className="text-sm text-[var(--text-secondary)] mt-0.5">
          {positionCount === 0 ? 'Fully in cash' : `${positionCount} position${positionCount > 1 ? 's' : ''} held`}
        </div>
      </Card>

      {/* Today's activity */}
      <Card label="Today's Activity">
        <div className="flex gap-4 mt-1">
          <div className="text-center">
            <div className="text-2xl font-bold text-[var(--accent-green)]">{todayStats.tradesExecuted}</div>
            <div className="text-xs text-[var(--text-muted)]">trades</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-[var(--accent-red)]">{todayStats.tradesBlocked}</div>
            <div className="text-xs text-[var(--text-muted)]">blocked</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-[var(--accent-yellow)]">{todayStats.alertsToday}</div>
            <div className="text-xs text-[var(--text-muted)]">alerts</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
