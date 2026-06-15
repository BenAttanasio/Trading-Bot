import { useState, useEffect } from 'react';

interface BotMood {
  label: string;
  description: string;
  colorKey: 'gray' | 'red' | 'orange' | 'blue' | 'green';
}

interface TokenUsage {
  total: number;
  budget: number;
  byModel: { budget: number; fast: number; deep: number };
}

export interface StatusIndicatorProps {
  botRunning: boolean;
  tradingPaused: boolean;
  marketState: string;
  lastHeartbeat: string;
  nextPulse: { time: string; label: string };
  botMood: BotMood;
  tokenUsage: TokenUsage;
  portfolioValue: number;
  dailyPL: number;
  dailyPLPercent: number;
  onTogglePause: () => void;
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

function marketColor(state: string): string {
  if (state === 'open') return 'text-[var(--accent-green)]';
  if (state === 'pre_market' || state === 'after_hours') return 'text-[var(--accent-yellow)]';
  return 'text-[var(--text-muted)]';
}

function moodDot(colorKey: BotMood['colorKey']): string {
  switch (colorKey) {
    case 'green':  return 'bg-[var(--accent-green)]';
    case 'red':    return 'bg-[var(--accent-red)]';
    case 'orange': return 'bg-orange-400';
    case 'blue':   return 'bg-[var(--accent-blue)]';
    default:       return 'bg-[var(--text-muted)]';
  }
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function formatTokenPct(usage: TokenUsage): { pct: number; isWarning: boolean } {
  const pct = Math.min(100, (usage.total / usage.budget) * 100);
  return { pct, isWarning: pct >= 90 };
}

export function StatusIndicator({
  botRunning, tradingPaused, marketState, lastHeartbeat,
  nextPulse, botMood, tokenUsage, portfolioValue, dailyPL, dailyPLPercent,
  onTogglePause
}: StatusIndicatorProps) {
  const heartbeatAge = useHeartbeatAge(lastHeartbeat);
  const isStale = heartbeatAge > 35 * 60;
  const countdown = useCountdown(nextPulse.time);
  const online = botRunning && !isStale;
  const { pct: tokenPct, isWarning: tokenWarning } = formatTokenPct(tokenUsage);

  const plPositive = dailyPL >= 0;
  const plColor = plPositive ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]';

  return (
    <div className="bg-[var(--bg-secondary)] border-b border-[var(--border)] px-4 h-11 flex items-center gap-0">

      {/* ── Left: System status ── */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Bot online/offline */}
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${online ? 'bg-[var(--accent-green)] animate-pulse' : 'bg-[var(--accent-red)]'}`} />
          <span className={`text-xs font-bold tracking-widest ${online ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
            {online ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        <span className="text-[var(--border)] select-none">│</span>

        {/* Market state */}
        <span className={`text-xs font-semibold ${marketColor(marketState)}`}>
          {marketState === 'open' ? 'MARKET OPEN' :
           marketState === 'pre_market' ? 'PRE-MARKET' :
           marketState === 'after_hours' ? 'AFTER HOURS' : 'MARKET CLOSED'}
        </span>

        <span className="text-[var(--border)] select-none">│</span>

        {/* Bot mood */}
        <div className="flex items-center gap-1.5" title={botMood.description}>
          <span className={`w-2 h-2 rounded-full shrink-0 ${moodDot(botMood.colorKey)}`} />
          <span className="text-xs text-[var(--text-secondary)]">{botMood.label}</span>
          <span className="text-xs text-[var(--text-muted)] hidden lg:block">— {botMood.description}</span>
        </div>
      </div>

      {/* ── Center: Portfolio value (the number you care about) ── */}
      <div className="flex-1 flex items-center justify-center gap-3">
        <span className="text-base font-bold">{formatCurrency(portfolioValue)}</span>
        <span className={`text-sm font-semibold ${plColor}`}>
          {plPositive ? '+' : ''}{formatCurrency(dailyPL)}
          <span className="text-xs ml-1 opacity-80">({plPositive ? '+' : ''}{dailyPLPercent.toFixed(2)}%)</span>
        </span>
        <span className="text-xs text-[var(--text-muted)]">today</span>
      </div>

      {/* ── Right: Controls ── */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Token budget pill */}
        <div
          className={`text-xs px-2 py-0.5 rounded ${tokenWarning ? 'bg-[var(--accent-yellow)]/20 text-[var(--accent-yellow)]' : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'}`}
          title={`Token usage: ${Math.round(tokenUsage.total / 1000)}k / ${Math.round(tokenUsage.budget / 1000)}k`}
        >
          {tokenPct.toFixed(0)}% tokens
        </div>

        {/* Next pulse */}
        <span className="text-xs text-[var(--text-muted)] hidden md:block">
          {countdown ? `Pulse ${countdown}` : nextPulse.label}
        </span>

        <span className="text-[var(--border)] select-none">│</span>

        {/* Pause / Resume */}
        <button
          onClick={onTogglePause}
          className={`px-3 py-1 text-xs font-bold rounded transition-colors ${
            tradingPaused
              ? 'bg-[var(--accent-yellow)]/20 text-[var(--accent-yellow)] border border-[var(--accent-yellow)]/40 hover:bg-[var(--accent-yellow)]/30'
              : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] border border-[var(--border)] hover:border-[var(--accent-red)]/50 hover:text-[var(--accent-red)]'
          }`}
        >
          {tradingPaused ? '⏸ PAUSED' : 'Pause'}
        </button>
      </div>
    </div>
  );
}
