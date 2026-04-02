import { useState, useEffect } from 'react';

interface StatusIndicatorProps {
  botRunning: boolean;
  tradingPaused: boolean;
  marketState: string;
  lastHeartbeat: string;
  nextPulse: { time: string; label: string };
}

function useCountdown(targetISO: string): string | null {
  const [remaining, setRemaining] = useState<string | null>(null);

  useEffect(() => {
    if (!targetISO) { setRemaining(null); return; }

    function tick() {
      const diff = Math.max(0, Math.floor((new Date(targetISO).getTime() - Date.now()) / 1000));
      if (diff <= 0) { setRemaining('now'); return; }
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setRemaining(m > 0 ? `${m}m ${s}s` : `${s}s`);
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetISO]);

  return remaining;
}

function useHeartbeatAge(lastHeartbeat: string): number {
  const [age, setAge] = useState(0);
  useEffect(() => {
    function tick() {
      setAge(Math.round((Date.now() - new Date(lastHeartbeat).getTime()) / 1000));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastHeartbeat]);
  return age;
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s ago` : `${m}m ago`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m ago` : `${h}h ago`;
}

export function StatusIndicator({ botRunning, tradingPaused, marketState, lastHeartbeat, nextPulse }: StatusIndicatorProps) {
  const heartbeatAge = useHeartbeatAge(lastHeartbeat);
  const isStale = heartbeatAge > 120;
  const countdown = useCountdown(nextPulse.time);

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

      <span className="text-xs text-[var(--text-muted)]">
        {countdown ? `Next pulse: ${countdown}` : nextPulse.label}
      </span>

      <span className="text-xs text-[var(--text-muted)] ml-auto">
        Last heartbeat: {formatAge(heartbeatAge)}
      </span>
    </div>
  );
}
