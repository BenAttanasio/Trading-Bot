interface StatusIndicatorProps {
  botRunning: boolean;
  tradingPaused: boolean;
  marketState: string;
  lastHeartbeat: string;
}

export function StatusIndicator({ botRunning, tradingPaused, marketState, lastHeartbeat }: StatusIndicatorProps) {
  const heartbeatAge = Math.round((Date.now() - new Date(lastHeartbeat).getTime()) / 1000);
  const isStale = heartbeatAge > 120;

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${botRunning && !isStale ? 'bg-[var(--accent-green)] animate-pulse' : 'bg-[var(--accent-red)]'}`} />
        <span className="text-sm font-medium">
          {botRunning && !isStale ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      {tradingPaused && (
        <span className="px-2 py-0.5 text-xs font-bold bg-[var(--accent-yellow)]/20 text-[var(--accent-yellow)] rounded">
          PAUSED
        </span>
      )}

      <span className={`px-2 py-0.5 text-xs rounded ${
        marketState === 'open' ? 'bg-[var(--accent-green)]/20 text-[var(--accent-green)]' :
        marketState === 'pre_market' || marketState === 'after_hours' ? 'bg-[var(--accent-yellow)]/20 text-[var(--accent-yellow)]' :
        'bg-[var(--text-muted)]/20 text-[var(--text-muted)]'
      }`}>
        {marketState.replace('_', ' ').toUpperCase()}
      </span>

      <span className="text-xs text-[var(--text-muted)] ml-auto">
        Last heartbeat: {heartbeatAge}s ago
      </span>
    </div>
  );
}
