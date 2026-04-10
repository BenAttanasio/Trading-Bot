import { useState, useEffect, useRef } from 'react';
import type { ActivityEvent } from '../types';

const STREAM_URL = '/api/activity/stream';
const MAX_EVENTS = 150;

function levelColor(level: string): string {
  switch (level) {
    case 'error': return 'text-[var(--accent-red)]';
    case 'warn': return 'text-[var(--accent-yellow)]';
    case 'info': return 'text-[var(--accent-blue)]';
    default: return 'text-[var(--text-muted)]';
  }
}

function levelBg(level: string): string {
  switch (level) {
    case 'error': return 'bg-[var(--accent-red)]/10';
    case 'warn': return 'bg-[var(--accent-yellow)]/10';
    default: return '';
  }
}

function serviceBadge(service: string): string {
  switch (service) {
    case 'Sentinel': return 'bg-purple-500/20 text-purple-400';
    case 'Scout': return 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]';
    case 'Execution': return 'bg-[var(--accent-green)]/20 text-[var(--accent-green)]';
    case 'Orchestrator': return 'bg-[var(--accent-yellow)]/20 text-[var(--accent-yellow)]';
    case 'PortfolioManager': return 'bg-cyan-500/20 text-cyan-400';
    case 'RiskManager': return 'bg-orange-500/20 text-orange-400';
    case 'Scheduler': return 'bg-indigo-500/20 text-indigo-400';
    case 'AlpacaTrading': return 'bg-emerald-500/20 text-emerald-400';
    default: return 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]';
  }
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = d.toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit', second: '2-digit' });
  if (isToday) return timeStr;
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${dateStr} · ${timeStr}`;
}

export function ActivityLog() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expanded, setExpanded] = useState(true);
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
        } catch { /* ignore parse errors */ }
      };

      source.onerror = () => {
        setConnected(false);
        source?.close();
        // Reconnect after 3 seconds
        reconnectTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      source?.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // If user scrolls up more than 40px from bottom, disable auto-scroll
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] flex flex-col">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs"
          >
            {expanded ? '\u25BC' : '\u25B6'}
          </button>
          <h3 className="font-semibold text-sm uppercase tracking-wide text-[var(--text-secondary)]">
            Live Activity
          </h3>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[var(--accent-green)]' : 'bg-[var(--accent-red)]'} animate-pulse`} />
        </div>
        <div className="flex items-center gap-2">
          {!autoScroll && (
            <button
              onClick={() => setAutoScroll(true)}
              className="text-xs text-[var(--accent-blue)] hover:underline"
            >
              Resume scroll
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

      {expanded && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="overflow-y-auto font-mono text-xs min-h-[300px] max-h-[340px]"
        >
          {events.length === 0 ? (
            <div className="p-4 text-center text-[var(--text-muted)]">
              {connected ? 'Waiting for activity...' : 'Connecting...'}
            </div>
          ) : (
            events.map((event) => (
              <div
                key={event.id}
                className={`flex items-start gap-2 px-3 py-1 border-b border-[var(--border)]/50 hover:bg-[var(--bg-hover)] ${levelBg(event.level)}`}
              >
                <span className="text-[var(--text-muted)] shrink-0 w-28">
                  {formatTime(event.timestamp)}
                </span>
                <span className={`${levelColor(event.level)} shrink-0 w-11 uppercase font-bold`}>
                  {event.level.slice(0, 5)}
                </span>
                <span className={`px-1.5 py-0 rounded text-[10px] font-semibold shrink-0 ${serviceBadge(event.service)}`}>
                  {event.service}
                </span>
                <span className="text-[var(--text-primary)] break-all">
                  {event.message}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
