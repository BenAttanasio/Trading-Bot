import { useState } from 'react';
import type { PositionData } from '../types';

interface PositionsTableProps {
  positions: PositionData[];
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function PositionsTable({ positions }: PositionsTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (positions.length === 0) {
    return (
      <div className="bg-[var(--bg-card)] rounded-lg p-6 border border-[var(--border)] text-center text-[var(--text-muted)]">
        No open positions
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-[var(--text-secondary)]">Open Positions</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--text-muted)] text-xs uppercase tracking-wide border-b border-[var(--border)]">
              <th className="text-left p-3">Symbol</th>
              <th className="text-right p-3">Entry</th>
              <th className="text-right p-3">Current</th>
              <th className="text-right p-3">P&L</th>
              <th className="text-right p-3">Value</th>
              <th className="text-center p-3">Days</th>
              <th className="text-center p-3">Thesis</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => {
              const plColor = pos.unrealizedPL >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]';
              const freshnessColor =
                pos.thesisFreshness === 'fresh' ? 'bg-[var(--accent-green)]' :
                pos.thesisFreshness === 'aging' ? 'bg-[var(--accent-yellow)]' :
                'bg-[var(--accent-red)]';

              return (
                <tr
                  key={pos.symbol}
                  className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)] cursor-pointer"
                  onClick={() => setExpanded(expanded === pos.symbol ? null : pos.symbol)}
                >
                  <td className="p-3 font-bold">{pos.symbol}</td>
                  <td className="p-3 text-right">{formatCurrency(pos.entryPrice)}</td>
                  <td className="p-3 text-right">{formatCurrency(pos.currentPrice)}</td>
                  <td className={`p-3 text-right font-medium ${plColor}`}>
                    {pos.unrealizedPL >= 0 ? '+' : ''}{formatCurrency(pos.unrealizedPL)}
                    <span className="text-xs ml-1">({pos.unrealizedPLPercent >= 0 ? '+' : ''}{pos.unrealizedPLPercent.toFixed(2)}%)</span>
                  </td>
                  <td className="p-3 text-right">{formatCurrency(pos.marketValue)}</td>
                  <td className="p-3 text-center">{pos.daysHeld}d</td>
                  <td className="p-3 text-center">
                    <div className={`w-2 h-2 rounded-full inline-block ${freshnessColor}`} title={pos.thesisFreshness || 'unknown'} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Expanded thesis view */}
      {expanded && (() => {
        const pos = positions.find((p) => p.symbol === expanded);
        if (!pos?.thesis) return null;
        return (
          <div className="px-4 py-3 bg-[var(--bg-hover)] border-t border-[var(--border)] text-sm">
            <span className="font-semibold text-[var(--accent-blue)]">{pos.symbol} Thesis:</span>{' '}
            <span className="text-[var(--text-secondary)]">{pos.thesis}</span>
          </div>
        );
      })()}
    </div>
  );
}
