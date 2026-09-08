import { useState, useEffect, useRef } from 'react';
import {
  AreaChart, Area,
  LineChart, Line,
  XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
  ReferenceLine,
} from 'recharts';
import type { DailySummaryData, LiveDataPoint } from '../types';
import { api } from '../api/client';

interface PerformanceChartProps {
  summaries: DailySummaryData[];
  portfolioValue: number;
}

type Range = '1W' | '1M' | '3M' | 'Live';
type Metric = 'portfolio' | 'invested' | 'pnl';

const RANGE_DAYS: Record<'1W' | '1M' | '3M', number> = { '1W': 7, '1M': 30, '3M': 90 };
// At 5s polling, 12 points = 1 minute. Show a tick every minute.
const LIVE_MAX_POINTS = 120; // 10 minutes of data visible at a time
const LIVE_TICK_INTERVAL = 11; // every 12th point = every ~minute

function fmtCurrency(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

function cutoffDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Pad a value range with buffer so chart isn't cramped. Always includes 0 for pnl. */
function computeDomain(values: number[], includePnlZero = false): [number, number] {
  if (values.length === 0) return includePnlZero ? [-500, 500] : [0, 1000];
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const min = includePnlZero ? Math.min(0, rawMin) : rawMin;
  const max = includePnlZero ? Math.max(0, rawMax) : rawMax;
  const spread = max - min;
  const pad = Math.max(spread * 0.15, includePnlZero ? 200 : 500);
  return [Math.floor(min - pad), Math.ceil(max + pad)];
}

/** Format YYYY-MM-DD for the x-axis — strips year, uses range-appropriate detail */
function formatDateTick(dateStr: string, range: '1W' | '1M' | '3M'): string {
  // Parse as local noon to avoid DST-induced off-by-one day issues
  const d = new Date(dateStr + 'T12:00:00');
  if (range === '1W') {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Pulsing dot at the latest live data point
function PulsingDot(props: {
  cx?: number; cy?: number; index?: number;
  dataLength: number; color: string;
}) {
  const { cx, cy, index, dataLength, color } = props;
  if (index !== dataLength - 1 || cx == null || cy == null) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill={color}>
        <animate attributeName="r" values="5;14;5" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.6;0;0.6" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy} r={4} fill={color} />
    </g>
  );
}

export function PerformanceChart({ summaries, portfolioValue }: PerformanceChartProps) {
  const [range, setRange] = useState<Range>('1M');
  const [metric, setMetric] = useState<Metric>('portfolio');
  const [liveData, setLiveData] = useState<LiveDataPoint[]>([]);
  const liveDataRef = useRef<LiveDataPoint[]>([]);

  const isLive = range === 'Live';

  // Live mode: seed on entry, poll every 5s, stop and clear on exit
  useEffect(() => {
    if (!isLive) {
      setLiveData([]);
      liveDataRef.current = [];
      return;
    }

    const now = new Date();
    const timeLabel = now.toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit' });
    const seed: LiveDataPoint = { time: timeLabel, value: portfolioValue };
    liveDataRef.current = [seed];
    setLiveData([seed]);

    const interval = setInterval(async () => {
      try {
        const fresh = await api.getDashboard();
        const t = new Date();
        const label = t.toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit' });
        const point: LiveDataPoint = { time: label, value: fresh.portfolio.value };
        // Cap to LIVE_MAX_POINTS so x-axis never clogs up
        const next = [...liveDataRef.current, point].slice(-LIVE_MAX_POINTS);
        liveDataRef.current = next;
        setLiveData(next);
      } catch {
        // silently ignore network errors in live mode
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isLive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Historical data (non-live)
  const allData = [...summaries]
    .reverse()
    .map((s) => ({ date: s.date, value: s.portfolioValue, invested: s.investedValue }));

  const minDate = !isLive ? cutoffDate(RANGE_DAYS[range as '1W' | '1M' | '3M']) : '';
  const filtered = !isLive ? allData.filter((s) => s.date >= minDate) : [];
  const baseData = filtered.length > 0 ? filtered : allData;
  const periodStart = baseData[0]?.value ?? 0;
  const historicalData = baseData.map((d) => ({ ...d, pnl: d.value - periodStart }));
  // Color grammar: green when up over the charted period, red when down.
  const periodDown = (historicalData[historicalData.length - 1]?.value ?? 0) < periodStart;

  // Historical chart config
  const dataKey = metric === 'portfolio' ? 'value' : metric === 'invested' ? 'invested' : 'pnl';
  const lineColor =
    metric === 'portfolio' ? (periodDown ? 'var(--crit)' : 'var(--ok)') :
    metric === 'invested'  ? 'var(--info)' :
                             (periodDown ? 'var(--crit)' : 'var(--ok)');
  const yLabel =
    metric === 'portfolio' ? 'Portfolio' :
    metric === 'invested'  ? 'Invested' :
                             'P&L';

  const histValues = historicalData.map((d) => (d as unknown as Record<string, number>)[dataKey]);
  const histDomain = computeDomain(histValues, metric === 'pnl');
  // Show ~6 x-axis ticks regardless of how many data points
  const histXInterval = Math.max(0, Math.ceil(historicalData.length / 6) - 1);

  // Live chart config
  const sessionStart = liveData[0]?.value ?? portfolioValue;
  const currentLive = liveData[liveData.length - 1]?.value ?? portfolioValue;
  const liveGain = currentLive - sessionStart;
  const liveGainPct = sessionStart !== 0 ? (liveGain / sessionStart) * 100 : 0;
  const isAboveStart = liveGain >= 0;
  const liveColorHex = isAboveStart ? '#3fb950' : '#f85149';
  const liveColorVar = isAboveStart ? 'var(--accent-green)' : 'var(--accent-red)';
  const liveDomain = computeDomain(liveData.map((d) => d.value));

  const tooltipStyle = {
    backgroundColor: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: '0.6rem',
    fontSize: '13px',
    color: 'var(--text-primary)',
  };

  const tickStyle = { fontSize: 12, fill: 'var(--text-muted)' };

  return (
    <div className="tile h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        {/* Left: metric toggles or live P&L */}
        <div className="flex items-center gap-3">
          {!isLive && (
            <div className="flex gap-1">
              {(['portfolio', 'invested', 'pnl'] as Metric[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMetric(m)}
                  className={`px-4 py-2 text-sm rounded font-medium transition-colors ${
                    metric === m
                      ? m === 'portfolio'
                        ? 'bg-[var(--bg-hover)] text-[var(--text)]'
                        : m === 'invested'
                          ? 'bg-[var(--bg-hover)] text-[var(--text)]'
                          : 'bg-[var(--bg-hover)] text-[var(--text)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  {m === 'portfolio' ? 'Portfolio Value' : m === 'invested' ? 'Invested' : 'P&L'}
                </button>
              ))}
            </div>
          )}
          {isLive && (
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg">{fmtCurrency(currentLive)}</span>
              <span className={`text-sm font-semibold ${isAboveStart ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                {liveGain >= 0 ? '+' : ''}{fmtCurrency(liveGain)}{' '}
                ({liveGainPct >= 0 ? '+' : ''}{liveGainPct.toFixed(2)}%)
              </span>
              <span className="w-2 h-2 rounded-full bg-[var(--accent-green)] animate-pulse inline-block" />
            </div>
          )}
        </div>

        {/* Right: range toggles */}
        <div className="flex gap-1">
          {(['1W', '1M', '3M', 'Live'] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-4 py-2 text-sm rounded font-medium transition-colors ${
                range === r
                  ? r === 'Live'
                    ? 'badge-coral'
                    : 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {r === 'Live' ? '● Live' : r}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1">
        {isLive ? (
          liveData.length < 2 ? (
            <div className="h-[300px] flex flex-col items-center justify-center text-[var(--text-muted)] gap-2">
              <span className="w-3 h-3 rounded-full bg-[var(--accent-green)] animate-pulse" />
              <span className="text-sm">Collecting live data...</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={liveData}>
                <defs>
                  <linearGradient id="liveGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={liveColorHex} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={liveColorHex} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="time"
                  tick={tickStyle}
                  interval={LIVE_TICK_INTERVAL}
                />
                <YAxis
                  tick={tickStyle}
                  domain={liveDomain}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                  width={60}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number | undefined) => [fmtCurrency(value ?? 0), 'Portfolio']}
                />
                <ReferenceLine
                  y={sessionStart}
                  stroke={liveColorHex}
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={liveColorVar}
                  strokeWidth={2}
                  fill="url(#liveGradient)"
                  dot={(props: { cx?: number; cy?: number; index?: number }) => (
                    <PulsingDot {...props} dataLength={liveData.length} color={liveColorHex} />
                  )}
                  activeDot={{ r: 6, fill: liveColorHex }}
                  isAnimationActive={true}
                  animationDuration={300}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          )
        ) : historicalData.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-[var(--text-muted)]">
            No performance data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={historicalData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tick={tickStyle}
                interval={histXInterval}
                tickFormatter={(v) => formatDateTick(v, range as '1W' | '1M' | '3M')}
              />
              <YAxis
                tick={tickStyle}
                domain={histDomain}
                width={65}
                tickFormatter={(v) => {
                  if (metric === 'pnl') {
                    const sign = v >= 0 ? '+' : '';
                    return `${sign}$${(v / 1000).toFixed(1)}k`;
                  }
                  return `$${(v / 1000).toFixed(1)}k`;
                }}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number | undefined) => [
                  metric === 'pnl'
                    ? `${(value ?? 0) >= 0 ? '+' : ''}${fmtCurrency(value ?? 0)}`
                    : fmtCurrency(value ?? 0),
                  yLabel,
                ]}
              />
              {metric === 'pnl' && (
                <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="3 3" strokeOpacity={0.8} />
              )}
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke={lineColor}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
