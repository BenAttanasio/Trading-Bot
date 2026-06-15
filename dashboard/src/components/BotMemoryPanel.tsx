import type { PositionData } from '../types';

interface Props {
  positions: PositionData[];
}

const FRESHNESS_CONFIG: Record<string, { color: string; dot: string; label: string }> = {
  fresh:  { color: 'text-[var(--accent-green)]',  dot: 'bg-[var(--accent-green)]',  label: 'Fresh' },
  aging:  { color: 'text-[var(--accent-yellow)]', dot: 'bg-[var(--accent-yellow)]', label: 'Aging' },
  stale:  { color: 'text-[var(--accent-red)]',    dot: 'bg-[var(--accent-red)]',    label: 'Stale — review due' },
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function PositionThesisCard({ pos }: { pos: PositionData }) {
  const win = pos.unrealizedPLPercent >= 0;
  const plColor = win ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]';
  const plBg = win ? 'bg-[var(--accent-green)]/10' : 'bg-[var(--accent-red)]/10';
  const plStr = `${win ? '+' : ''}${pos.unrealizedPLPercent.toFixed(2)}%`;
  const freshness = FRESHNESS_CONFIG[pos.thesisFreshness ?? 'stale'] ?? FRESHNESS_CONFIG.stale;

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] p-4 hover:border-[var(--accent-blue)]/30 transition-colors">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-wide">{pos.symbol}</span>
          {/* P&L badge */}
          <span className={`text-sm font-bold px-2 py-0.5 rounded ${plBg} ${plColor}`}>
            {plStr}
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            {formatCurrency(pos.unrealizedPL)} unrealized
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] shrink-0">
          {/* Thesis freshness */}
          <span className={`flex items-center gap-1 font-medium ${freshness.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${freshness.dot}`} />
            {freshness.label}
          </span>
          {/* Days held */}
          <span>{pos.daysHeld}d held</span>
          {/* Market value */}
          <span className="font-medium text-[var(--text-secondary)]">{formatCurrency(pos.marketValue)}</span>
        </div>
      </div>

      {/* Thesis — the main content */}
      {pos.thesis ? (
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          {pos.thesis}
        </p>
      ) : (
        <p className="text-sm text-[var(--text-muted)] italic">
          No thesis recorded — position may have been opened manually.
        </p>
      )}

      {/* Price context footer */}
      <div className="flex gap-6 mt-3 pt-3 border-t border-[var(--border)] text-xs">
        <span className="text-[var(--text-muted)]">
          Entry <span className="text-[var(--text-secondary)] font-medium">${pos.entryPrice.toFixed(2)}</span>
        </span>
        <span className="text-[var(--text-muted)]">
          Current <span className="text-[var(--text-secondary)] font-medium">${pos.currentPrice.toFixed(2)}</span>
        </span>
        <span className="text-[var(--text-muted)]">
          Qty <span className="text-[var(--text-secondary)] font-medium">{pos.qty}</span>
        </span>
      </div>
    </div>
  );
}

export function BotMemoryPanel({ positions }: Props) {
  if (positions.length === 0) {
    return (
      <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] p-10 text-center">
        <div className="text-[var(--text-muted)] text-sm">No open positions — fully in cash</div>
      </div>
    );
  }

  const staleCount = positions.filter((p) => p.thesisFreshness === 'stale').length;

  return (
    <div className="space-y-3">
      {staleCount > 0 && (
        <div className="flex items-center gap-2 text-xs text-[var(--accent-yellow)] bg-[var(--accent-yellow)]/10 border border-[var(--accent-yellow)]/20 rounded-lg px-4 py-2">
          <span>⚠</span>
          <span>
            {staleCount} position{staleCount > 1 ? 's have' : ' has'} a stale thesis (not updated in 3+ days). The bot will use its deep model on next review.
          </span>
        </div>
      )}
      {positions.map((pos) => (
        <PositionThesisCard key={pos.symbol} pos={pos} />
      ))}
    </div>
  );
}
