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
    <div className="tile flex flex-col gap-1">
      <div className="section-title mb-1">{label}</div>
      {children}
    </div>
  );
}

export function PortfolioSummary({ value, cash, invested, dailyPL, dailyPLPercent, positionCount, todayStats }: PortfolioSummaryProps) {
  const down = dailyPL < 0;
  // Headline numbers stay neutral; only the change line turns red when we're down.
  const plColor = down ? 'text-[var(--crit)]' : 'text-[var(--text)]';
  const exposure = value > 0 ? (invested / value) * 100 : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card label="Portfolio Value">
        <div className="text-2xl font-bold">{formatCurrency(value)}</div>
        <div className={`text-sm font-semibold ${plColor}`}>
          {down ? '' : '+'}{formatCurrency(dailyPL)}{' '}
          <span className="text-xs opacity-80">({down ? '' : '+'}{dailyPLPercent.toFixed(2)}%)</span>
        </div>
        <div className="chart-hint">today vs. yesterday's close</div>
      </Card>

      <Card label="Allocation">
        <div className="text-xl font-bold">{formatCurrency(invested)}</div>
        <div className="text-sm text-[var(--text-secondary)]">{formatCurrency(cash)} cash</div>
        <div className="mt-1 h-1.5 bg-[var(--bg-hover)] rounded-full overflow-hidden">
          <div className="h-full bg-[var(--accent)] rounded-full" style={{ width: `${Math.min(100, exposure)}%` }} />
        </div>
        <div className="chart-hint">{exposure.toFixed(0)}% deployed</div>
      </Card>

      <Card label="Open Positions">
        <div className="text-3xl font-bold">{positionCount}</div>
        <div className="chart-hint">
          {positionCount === 0 ? 'fully in cash' : `${positionCount} position${positionCount > 1 ? 's' : ''} held`}
        </div>
      </Card>

      <Card label="Today's Activity">
        <div className="flex gap-5 mt-1">
          <div>
            <div className="text-2xl font-bold">{todayStats.tradesExecuted}</div>
            <div className="chart-hint">trades</div>
          </div>
          <div>
            <div className={`text-2xl font-bold ${todayStats.tradesBlocked > 0 ? 'text-[var(--warn)]' : ''}`}>{todayStats.tradesBlocked}</div>
            <div className="chart-hint">blocked</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{todayStats.alertsToday}</div>
            <div className="chart-hint">alerts</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
