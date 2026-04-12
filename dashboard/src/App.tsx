import { useCallback, useState } from 'react';
import { api } from './api/client';
import { usePolling } from './hooks/usePolling';
import { Layout } from './components/Layout';
import { StatusIndicator } from './components/StatusIndicator';
import { PortfolioSummary } from './components/PortfolioSummary';
import { PositionsTable } from './components/PositionsTable';
import { TradesFeed } from './components/TradesFeed';
import { SentinelAlerts } from './components/SentinelAlerts';
import { PerformanceChart } from './components/PerformanceChart';
import { WatchlistManager } from './components/WatchlistManager';
import { ConfigPanel } from './components/ConfigPanel';
import { ActivityLog } from './components/ActivityLog';
import type { DashboardData } from './types';

function App() {
  const fetchDashboard = useCallback(() => api.getDashboard(), []);
  const { data, error, loading, refresh } = usePolling<DashboardData>(fetchDashboard, 30 * 60 * 1000);

  const handleTogglePause = useCallback(async () => {
    if (!data) return;
    if (data.status.tradingPaused) {
      await api.resumeTrading();
    } else {
      await api.pauseTrading();
    }
    refresh();
  }, [data, refresh]);

  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[var(--text-muted)] text-lg">Connecting to AI Trader...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-[var(--accent-red)] text-lg mb-2">Connection Error</div>
          <div className="text-[var(--text-muted)] text-sm">{error}</div>
          <div className="text-[var(--text-muted)] text-xs mt-2">Make sure the backend is running on port 3001</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <Layout
      statusBar={
        <StatusIndicator
          botRunning={data.status.botRunning}
          tradingPaused={data.status.tradingPaused}
          marketState={data.status.marketState}
          lastHeartbeat={data.status.lastHeartbeat}
          nextPulse={data.status.nextPulse}
          onTogglePause={handleTogglePause}
        />
      }
    >
      <div className="space-y-4 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">AI Trader Dashboard</h1>
          {error && (
            <span className="text-xs text-[var(--accent-yellow)]">Stale data - reconnecting...</span>
          )}
        </div>

        <PortfolioSummary
          value={data.portfolio.value}
          cash={data.portfolio.cash}
          invested={data.portfolio.invested}
          dailyPL={data.portfolio.dailyPL}
          dailyPLPercent={data.portfolio.dailyPLPercent}
          positionCount={data.portfolio.positionCount}
          todayStats={data.todayStats}
        />

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-3">
            <PerformanceChart summaries={data.dailySummaries} portfolioValue={data.portfolio.value} />
          </div>
          <div className="md:col-span-2">
            <ActivityLog />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TradesFeed trades={data.recentTrades} />
          <SentinelAlerts alerts={data.recentAlerts} />
        </div>

        <PositionsTable positions={data.positions} />

        <CollapsibleControls />
      </div>
    </Layout>
  );
}

function CollapsibleControls() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
      >
        <span>Controls & Watchlist</span>
        <span className="text-[var(--text-muted)] text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border-t border-[var(--border)]">
          <ConfigPanel />
          <WatchlistManager />
        </div>
      )}
    </div>
  );
}

export default App;
