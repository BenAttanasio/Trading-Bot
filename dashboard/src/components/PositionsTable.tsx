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
      <div className="tile text-center text-[var(--muted)]">
        No open positions
      </div>
    );
  }

  return (
    <div className="tile !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--divider)]">
        <h3 className="section-title">Open Positions</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--accent)] text-[0.68rem] uppercase tracking-[0.14em] border-b border-[var(--divider)]">
              <th className="text-left p-3 font-semibold">Symbol</th>
              <th className="text-right p-3 font-semibold">Entry</th>
              <th className="text-right p-3 font-semibold">Current</th>
              <th className="text-right p-3 font-semibold">P&L</th>
              <th className="text-right p-3 font-semibold">Value</th>
              <th className="text-center p-3 font-semibold">Days</th>
              <th className="text-center p-3 font-semibold">Thesis</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => {
              const plColor = pos.unrealizedPL < 0 ? 'text-[var(--crit)]' : 'text-[var(--text)]';
              const freshnessColor =
                pos.thesisFreshness === 'fresh' ? 'bg-[var(--ok)]' :
                pos.thesisFreshness === 'aging' ? 'bg-[var(--warn)]' :
                'bg-[var(--crit)]';

              return (
                <tr
                  key={pos.symbol}
                  className="border-b border-[var(--divider)] hover:bg-[var(--bg-hover)] cursor-pointer"
                  onClick={() => setExpanded(expanded === pos.symbol ? null : pos.symbol)}
                >
                  <td className="p-3 font-bold">{pos.symbol}</td>
                  <td className="p-3 text-right">{formatCurrency(pos.entryPrice)}</td>
                  <td className="p-3 text-right">{formatCurrency(pos.currentPrice)}</td>
                  <td className={`p-3 text-right font-medium ${plColor}`}>
                    {pos.unrealizedPL >= 0 ? '+' : ''}{formatCurrency(pos.unrealizedPL)}
                    <span className="text-xs ml-1 opacity-80">({pos.unrealizedPLPercent >= 0 ? '+' : ''}{pos.unrealizedPLPercent.toFixed(2)}%)</span>
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

      {expanded && (() => {
        const pos = positions.find((p) => p.symbol === expanded);
        if (!pos?.thesis) return null;
        return (
          <div className="px-4 py-3 bg-[var(--bg-hover)] border-t border-[var(--divider)] text-sm">
            <span className="font-semibold text-[var(--accent)]">{pos.symbol} thesis:</span>{' '}
            <span className="text-[var(--text-secondary)]">{pos.thesis}</span>
          </div>
        );
      })()}
    </div>
  );
}
