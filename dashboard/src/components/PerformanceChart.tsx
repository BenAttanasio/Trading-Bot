import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { DailySummaryData } from '../types';

interface PerformanceChartProps {
  summaries: DailySummaryData[];
}

export function PerformanceChart({ summaries }: PerformanceChartProps) {
  const data = [...summaries]
    .reverse()
    .map((s) => ({
      date: s.date,
      value: s.portfolioValue,
      pl: s.dailyPL,
    }));

  if (data.length === 0) {
    return (
      <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] p-6 text-center text-[var(--text-muted)]">
        No performance data yet
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] p-4">
      <h3 className="font-semibold text-sm uppercase tracking-wide text-[var(--text-secondary)] mb-4">Portfolio Value</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
              color: 'var(--text-primary)',
            }}
            formatter={(value: number) => [`$${value.toFixed(2)}`, 'Portfolio']}
          />
          <Line type="monotone" dataKey="value" stroke="var(--accent-blue)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
