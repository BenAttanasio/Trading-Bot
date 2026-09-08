import { useState } from 'react';
import type { TradeData } from '../types';

interface TradesFeedProps {
  trades: TradeData[];
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

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function convictionBar(conviction: number) {
  const bars = 10;
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 w-2 rounded-sm ${
            i < conviction
              ? conviction >= 8 ? 'bg-[var(--accent-green)]'
              : conviction >= 6 ? 'bg-[var(--accent-blue)]'
              : 'bg-[var(--accent-yellow)]'
              : 'bg-[var(--bg-hover)]'
          }`}
        />
      ))}
      <span className="text-[10px] text-[var(--text-muted)] ml-1">{conviction}/10</span>
    </div>
  );
}

export function TradesFeed({ trades }: TradesFeedProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)]">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-[var(--text-secondary)]">Recent Trades</h3>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="p-6 text-center text-[var(--text-muted)] text-sm">No trades yet</div>
        ) : (
          trades.map((trade, i) => {
            const intent = trade.intent ?? (trade.action === 'BUY' ? 'open_long' : 'close_long');
            const isBuy = intent === 'open_long' || intent === 'close_short';
            const label = intent === 'open_long' ? 'BUY' : intent === 'close_long' ? 'SELL' : intent === 'open_short' ? 'SHORT' : 'COVER';
            const isOpen = expandedId === i;
            return (
              <div key={i}>
                <div
                  className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border)] hover:bg-[var(--bg-hover)] cursor-pointer"
                  onClick={() => setExpandedId(isOpen ? null : i)}
                >
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded shrink-0 ${
                    isBuy
                      ? 'bg-[var(--accent-green)]/20 text-[var(--accent-green)]'
                      : 'bg-[var(--accent-red)]/20 text-[var(--accent-red)]'
                  }`}>
                    {label}
                  </span>
                  <span className="font-bold text-sm">{trade.symbol}</span>
                  <span className="text-sm text-[var(--text-secondary)] tabular-nums">{formatCurrency(trade.notional)}</span>
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-muted)]">
                      {trade.trigger.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-[var(--text-muted)] w-14 text-right shrink-0">{timeAgo(trade.createdAt)}</span>
                    <span className="text-[var(--text-muted)] text-xs">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </div>

                {isOpen && (
                  <div className="px-4 py-3 bg-[var(--bg-hover)] border-b border-[var(--border)] space-y-2">
                    {convictionBar(trade.aiConviction)}
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{trade.aiReasoning}</p>
                    <div className="text-xs text-[var(--text-muted)]">
                      Status: <span className={`font-medium ${trade.orderStatus === 'filled' ? 'text-[var(--accent-green)]' : 'text-[var(--text-secondary)]'}`}>{trade.orderStatus}</span>
                      {' · '}@${trade.price.toFixed(2)}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
