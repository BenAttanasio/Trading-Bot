import { useState, useEffect } from 'react';
import { api } from '../api/client';
import type { WatchlistItem } from '../types';

export function WatchlistManager() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [newSymbol, setNewSymbol] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchWatchlist = async () => {
    try {
      const data = await api.getWatchlist();
      setWatchlist(data.watchlist);
    } catch {
      // Ignore errors silently
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchWatchlist(); }, []);

  const addSymbol = async () => {
    if (!newSymbol.trim()) return;
    await api.addToWatchlist(newSymbol.trim().toUpperCase());
    setNewSymbol('');
    fetchWatchlist();
  };

  const removeSymbol = async (symbol: string) => {
    await api.removeFromWatchlist(symbol);
    fetchWatchlist();
  };

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)]">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-[var(--text-secondary)]">Watchlist</h3>
      </div>

      <div className="p-3">
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && addSymbol()}
            placeholder="Add ticker..."
            className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
          />
          <button
            onClick={addSymbol}
            className="px-3 py-1.5 bg-[var(--accent-blue)] text-white text-sm rounded hover:opacity-80"
          >
            Add
          </button>
        </div>

        <div className="max-h-64 overflow-y-auto space-y-1">
          {loading ? (
            <div className="text-center text-[var(--text-muted)] text-sm py-2">Loading...</div>
          ) : watchlist.length === 0 ? (
            <div className="text-center text-[var(--text-muted)] text-sm py-2">Empty watchlist</div>
          ) : (
            watchlist.map((item) => (
              <div key={item.symbol} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-[var(--bg-hover)]">
                <div>
                  <span className="font-bold text-sm">{item.symbol}</span>
                  <span className="text-xs text-[var(--text-muted)] ml-2">{item.sector}</span>
                </div>
                <button
                  onClick={() => removeSymbol(item.symbol)}
                  className="text-[var(--text-muted)] hover:text-[var(--accent-red)] text-xs"
                >
                  X
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
