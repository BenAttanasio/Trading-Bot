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
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function TradesFeed({ trades }: TradesFeedProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)]">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-[var(--text-secondary)]">Recent Trades</h3>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="p-4 text-center text-[var(--text-muted)]">No trades yet</div>
        ) : (
          trades.map((trade, i) => {
            const isBuy = trade.action === 'BUY';
            return (
              <div key={i}>
                <div
                  className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] hover:bg-[var(--bg-hover)] cursor-pointer"
                  onClick={() => setExpandedId(expandedId === i ? null : i)}
                >
                  <div className="flex items-center gap-3">
                    <span className={`px-1.5 py-0.5 text-xs font-bold rounded ${isBuy ? 'bg-[var(--accent-green)]/20 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/20 text-[var(--accent-red)]'}`}>
                      {trade.action}
                    </span>
                    <span className="font-bold text-sm">{trade.symbol}</span>
                    <span className="text-sm text-[var(--text-secondary)]">{formatCurrency(trade.notional)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-muted)]">
                      {trade.trigger}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">{timeAgo(trade.createdAt)}</span>
                  </div>
                </div>
                {expandedId === i && (
                  <div className="px-4 py-2.5 bg-[var(--bg-hover)] text-xs border-b border-[var(--border)]">
                    <div className="text-[var(--text-secondary)]">
                      <span className="text-[var(--accent-blue)]">AI (conviction {trade.aiConviction}/10):</span> {trade.aiReasoning}
                    </div>
                    <div className="text-[var(--text-muted)] mt-1">Status: {trade.orderStatus}</div>
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
