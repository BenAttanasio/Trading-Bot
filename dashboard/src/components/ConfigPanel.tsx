import { useState, useEffect } from 'react';
import { api } from '../api/client';

export function ConfigPanel() {
  const [config, setConfig] = useState<any>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    api.getConfig().then((data) => {
      setConfig(data.rules);
      setPaused(data.tradingPaused);
    }).catch(() => {});
  }, []);

  const togglePause = async () => {
    if (paused) {
      await api.resumeTrading();
      setPaused(false);
    } else {
      await api.pauseTrading();
      setPaused(true);
    }
  };

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)]">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-[var(--text-secondary)]">Controls</h3>
      </div>

      <div className="p-4 space-y-3">
        {/* Kill Switch */}
        <button
          onClick={togglePause}
          className={`w-full py-2.5 rounded font-bold text-sm ${
            paused
              ? 'bg-[var(--accent-green)] text-white hover:opacity-80'
              : 'bg-[var(--accent-red)] text-white hover:opacity-80'
          }`}
        >
          {paused ? 'RESUME TRADING' : 'PAUSE TRADING'}
        </button>

        {config && (
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">Max Position Size</span>
              <span>${config.maxPositionSizeDollars}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">Max Portfolio Exposure</span>
              <span>${config.maxPortfolioExposure}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">Max Daily Trades</span>
              <span>{config.maxDailyTrades}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">Daily Loss Circuit Breaker</span>
              <span>{config.maxDailyLossPercent}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">Cooldown</span>
              <span>{config.cooldownMinutes}m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">Sentinel Interval</span>
              <span>{config.sentinelPollIntervalSeconds}s</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
