import type { AlertData } from '../types';

interface SentinelAlertsProps {
  alerts: AlertData[];
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function urgencyBadge(urgency: number) {
  if (urgency >= 7) return 'bg-[var(--accent-red)]/20 text-[var(--accent-red)]';
  if (urgency >= 4) return 'bg-[var(--accent-yellow)]/20 text-[var(--accent-yellow)]';
  return 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]';
}

export function SentinelAlerts({ alerts }: SentinelAlertsProps) {
  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)]">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-[var(--text-secondary)]">Sentinel Alerts</h3>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="p-4 text-center text-[var(--text-muted)]">No alerts</div>
        ) : (
          alerts.map((alert, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-2.5 border-b border-[var(--border)]">
              <span className={`px-1.5 py-0.5 text-xs font-bold rounded shrink-0 ${urgencyBadge(alert.urgency)}`}>
                {alert.urgency}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm">{alert.symbol}</span>
                  <span className={`text-xs ${alert.direction === 'bullish' ? 'text-[var(--accent-green)]' : alert.direction === 'bearish' ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'}`}>
                    {alert.direction}
                  </span>
                </div>
                <div className="text-xs text-[var(--text-secondary)] truncate">{alert.headline}</div>
              </div>
              <span className="text-xs text-[var(--text-muted)] shrink-0">{timeAgo(alert.createdAt)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
