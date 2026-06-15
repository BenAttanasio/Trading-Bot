import { useState, useEffect, useRef } from 'react';
import type { ActivityEvent } from '../types';

const STREAM_URL = '/api/activity/stream';
const MAX_EVENTS = 200;

function levelColor(level: string): string {
  switch (level) {
    case 'error': return 'text-[var(--accent-red)]';
    case 'warn':  return 'text-[var(--accent-yellow)]';
    case 'info':  return 'text-[var(--accent-blue)]';
    default:      return 'text-[var(--text-muted)]';
  }
}

function levelBg(level: string): string {
  switch (level) {
    case 'error': return 'bg-[var(--accent-red)]/8';
    case 'warn':  return 'bg-[var(--accent-yellow)]/6';
    default:      return '';
  }
}

function serviceBadge(service: string): string {
  switch (service) {
    case 'Sentinel':        return 'bg-purple-500/20 text-purple-400';
    case 'Scout':           return 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]';
    case 'Execution':       return 'bg-[var(--accent-green)]/20 text-[var(--accent-green)]';
    case 'Orchestrator':    return 'bg-[var(--accent-yellow)]/20 text-[var(--accent-yellow)]';
    case 'PortfolioManager':return 'bg-cyan-500/20 text-cyan-400';
    case 'RiskManager':     return 'bg-orange-500/20 text-orange-400';
    case 'Scheduler':       return 'bg-indigo-500/20 text-indigo-400';
    case 'AlpacaTrading':   return 'bg-emerald-500/20 text-emerald-400';
    default:                return 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]';
  }
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ActivityLog() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      source = new EventSource(STREAM_URL);
      source.onopen = () => setConnected(true);
      source.onmessage = (e) => {
        try {
          const event: ActivityEvent = JSON.parse(e.data);
          setEvents((prev) => {
            const next = [...prev, event];
            return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
          });
        } catch { /* ignore */ }
      };
      source.onerror = () => {
        setConnected(false);
        source?.close();
        reconnectTimer = setTimeout(connect, 3000);
      };
    }

    connect();
    return () => { source?.close(); clearTimeout(reconnectTimer); };
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  }

  const filtered = filter === 'all'
    ? events
    : filter === 'errors'
    ? events.filter((e) => e.level === 'error' || e.level === 'warn')
    : events.filter((e) => e.service === filter);

  // Group by date for rendering
  let lastDate = '';

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm uppercase tracking-wide text-[var(--text-secondary)]">
            Live Activity
          </span>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[var(--accent-green)] animate-pulse' : 'bg-[var(--accent-red)]'}`} />
          <span className="text-xs text-[var(--text-muted)]">{events.length} events</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Level filter */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs bg-[var(--bg-hover)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text-secondary)] cursor-pointer"
          >
            <option value="all">All</option>
            <option value="errors">Errors & Warnings</option>
            <option value="Sentinel">Sentinel</option>
            <option value="Execution">Execution</option>
            <option value="PortfolioManager">Portfolio Mgr</option>
            <option value="Scheduler">Scheduler</option>
          </select>

          {!autoScroll && (
            <button
              onClick={() => setAutoScroll(true)}
              className="text-xs text-[var(--accent-blue)] hover:underline"
            >
              ↓ Live
            </button>
          )}
          <button
            onClick={() => setEvents([])}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Log stream */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto font-mono text-xs"
      >
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-[var(--text-muted)]">
            {connected ? 'Waiting for activity...' : 'Connecting to stream...'}
          </div>
        ) : (
          filtered.map((event) => {
            const date = formatDate(event.timestamp);
            const showDate = date !== lastDate;
            lastDate = date;

            return (
              <div key={event.id}>
                {showDate && (
                  <div className="px-3 py-1 text-[10px] text-[var(--text-muted)] bg-[var(--bg-secondary)]/50 border-b border-t border-[var(--border)]/40 uppercase tracking-wider">
                    {date}
                  </div>
                )}
                <div className={`flex items-start gap-2 px-3 py-1 border-b border-[var(--border)]/30 hover:bg-[var(--bg-hover)] ${levelBg(event.level)}`}>
                  <span className="text-[var(--text-muted)] shrink-0 w-24 tabular-nums">
                    {formatTime(event.timestamp)}
                  </span>
                  <span className={`${levelColor(event.level)} shrink-0 w-10 uppercase font-bold`}>
                    {event.level.slice(0, 4)}
                  </span>
                  <span className={`px-1.5 rounded text-[10px] font-semibold shrink-0 ${serviceBadge(event.service)}`}>
                    {event.service}
                  </span>
                  <span className="text-[var(--text-primary)] break-words min-w-0">
                    {event.message}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
