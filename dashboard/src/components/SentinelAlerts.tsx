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

function urgencyConfig(urgency: number) {
  if (urgency >= 7) return { badge: 'bg-[var(--accent-red)]/20 text-[var(--accent-red)]', border: 'border-l-[var(--accent-red)]/40' };
  if (urgency >= 4) return { badge: 'bg-[var(--accent-yellow)]/20 text-[var(--accent-yellow)]', border: 'border-l-[var(--accent-yellow)]/40' };
  return { badge: 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]', border: 'border-l-transparent' };
}

export function SentinelAlerts({ alerts }: SentinelAlertsProps) {
  const highUrgency = alerts.filter((a) => a.urgency >= 7).length;

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)]">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-[var(--text-secondary)]">
          Sentinel Alerts
        </h3>
        {highUrgency > 0 && (
          <span className="text-xs bg-[var(--accent-red)]/20 text-[var(--accent-red)] px-2 py-0.5 rounded font-bold">
            {highUrgency} urgent
          </span>
        )}
      </div>
      <div className="max-h-56 overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="p-6 text-center text-[var(--text-muted)] text-sm">No alerts</div>
        ) : (
          alerts.map((alert, i) => {
            const { badge, border } = urgencyConfig(alert.urgency);
            return (
              <div
                key={i}
                className={`flex items-start gap-3 px-4 py-3 border-b border-[var(--border)] border-l-2 ${border}`}
              >
                <span className={`px-1.5 py-0.5 text-xs font-bold rounded shrink-0 tabular-nums ${badge}`}>
                  {alert.urgency}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-bold text-sm">{alert.symbol}</span>
                    <span className={`text-xs font-medium ${
                      alert.direction === 'bullish' ? 'text-[var(--accent-green)]' :
                      alert.direction === 'bearish' ? 'text-[var(--accent-red)]' :
                      'text-[var(--text-muted)]'
                    }`}>
                      {alert.direction}
                    </span>
                    <span className="text-xs text-[var(--text-muted)] ml-auto">{timeAgo(alert.createdAt)}</span>
                  </div>
                  <div className="text-xs text-[var(--text-secondary)] line-clamp-2">{alert.headline}</div>
                  {alert.actionTaken && alert.actionTaken !== 'none' && (
                    <div className="text-xs text-[var(--accent-blue)] mt-1">→ {alert.actionTaken}</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
