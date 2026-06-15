import { useCallback, useState } from 'react';
import { api } from './api/client';
import { usePolling } from './hooks/usePolling';
import { StatusIndicator } from './components/StatusIndicator';
import { PortfolioSummary } from './components/PortfolioSummary';
import { PositionsTable } from './components/PositionsTable';
import { TradesFeed } from './components/TradesFeed';
import { SentinelAlerts } from './components/SentinelAlerts';
import { PerformanceChart } from './components/PerformanceChart';
import { WatchlistManager } from './components/WatchlistManager';
import { ConfigPanel } from './components/ConfigPanel';
import { ActivityLog } from './components/ActivityLog';
import { OutcomesPanel } from './components/OutcomesPanel';
import { BotMemoryPanel } from './components/BotMemoryPanel';
import type { DashboardData, OutcomesData } from './types';

// ─── Tab definition ──────────────────────────────────────
type TabId = 'overview' | 'positions' | 'journal' | 'feed' | 'settings';

interface TabDef {
  id: TabId;
  label: string;
  badge?: number;
}

function TabBar({ tabs, active, onSelect, stale }: {
  tabs: TabDef[];
  active: TabId;
  onSelect: (id: TabId) => void;
  stale?: boolean;
}) {
  return (
    <div className="bg-[var(--bg-secondary)] border-b border-[var(--border)] flex items-center px-2">
      <nav className="flex flex-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              active === tab.id
                ? 'border-[var(--accent-blue)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--border)]'
            }`}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className={`text-xs px-1.5 py-0 rounded-full font-bold ${
                active === tab.id
                  ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]'
                  : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'
              }`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </nav>
      {stale && (
        <span className="text-xs text-[var(--accent-yellow)] pr-4">⚠ Stale data</span>
      )}
    </div>
  );
}

// ─── Loading / Error screens ─────────────────────────────
function Connecting() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin mx-auto" />
        <div className="text-[var(--text-muted)]">Connecting to AI Trader...</div>
      </div>
    </div>
  );
}

function ConnectError({ error }: { error: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
      <div className="text-center space-y-2">
        <div className="text-[var(--accent-red)] text-lg font-semibold">Connection Error</div>
        <div className="text-[var(--text-muted)] text-sm">{error}</div>
        <div className="text-[var(--text-muted)] text-xs">Make sure the backend is running on port 3001</div>
      </div>
    </div>
  );
}

// ─── Tab content ─────────────────────────────────────────

function OverviewTab({ data }: { data: DashboardData }) {
  return (
    <div className="p-5 space-y-5 max-w-7xl mx-auto">
      <PortfolioSummary
        value={data.portfolio.value}
        cash={data.portfolio.cash}
        invested={data.portfolio.invested}
        dailyPL={data.portfolio.dailyPL}
        dailyPLPercent={data.portfolio.dailyPLPercent}
        positionCount={data.portfolio.positionCount}
        todayStats={data.todayStats}
      />
      <PerformanceChart summaries={data.dailySummaries} portfolioValue={data.portfolio.value} />
    </div>
  );
}

function PositionsTab({ data }: { data: DashboardData }) {
  const hasPositions = data.positions.length > 0;
  return (
    <div className="p-5 space-y-5 max-w-7xl mx-auto">
      {!hasPositions ? (
        <div className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] p-16 text-center space-y-2">
          <div className="text-3xl mb-2">📭</div>
          <div className="text-[var(--text-secondary)] font-medium">No open positions</div>
          <div className="text-[var(--text-muted)] text-sm">The bot is fully in cash, watching for opportunities.</div>
        </div>
      ) : (
        <>
          {/* Thesis cards are the primary focus — this is what the bot believes */}
          <div>
            <SectionHeader
              title="What the Bot Believes"
              subtitle="AI thesis for each open position — updated after every review"
            />
            <BotMemoryPanel positions={data.positions} />
          </div>
          {/* Raw position data as supporting detail */}
          <div>
            <SectionHeader title="Position Data" subtitle="Live prices from Alpaca" />
            <PositionsTable positions={data.positions} />
          </div>
        </>
      )}
    </div>
  );
}

function JournalTab({ outcomesData }: { outcomesData: OutcomesData | null }) {
  return (
    <div className="p-5 max-w-7xl mx-auto">
      <SectionHeader
        title="Trade Outcome Journal"
        subtitle="Did the strategy actually work? Win rates by trigger, conviction, and exit reason."
      />
      <OutcomesPanel data={outcomesData} />
    </div>
  );
}

function FeedTab({ data }: { data: DashboardData }) {
  return (
    <div className="flex gap-4 p-5 h-[calc(100vh-88px)] max-w-[1600px] mx-auto">
      {/* Left column: recent decisions */}
      <div className="w-[400px] shrink-0 flex flex-col gap-4 overflow-y-auto">
        <TradesFeed trades={data.recentTrades} />
        <SentinelAlerts alerts={data.recentAlerts} />
      </div>
      {/* Right column: live activity stream — takes remaining width */}
      <div className="flex-1 min-w-0 flex flex-col">
        <ActivityLog />
      </div>
    </div>
  );
}

function SettingsTab() {
  return (
    <div className="p-5 max-w-3xl mx-auto space-y-5">
      <SectionHeader title="Configuration & Watchlist" subtitle="Trading rules and symbols under surveillance" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <ConfigPanel />
        <WatchlistManager />
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h2 className="font-semibold text-[var(--text-primary)]">{title}</h2>
      {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ─── Root App ────────────────────────────────────────────
function App() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const fetchDashboard = useCallback(() => api.getDashboard(), []);
  const { data, error, loading, refresh } = usePolling<DashboardData>(fetchDashboard, 30 * 60 * 1000);

  const fetchOutcomes = useCallback(() => api.getOutcomes(), []);
  const { data: outcomesData } = usePolling<OutcomesData>(fetchOutcomes, 10 * 60 * 1000);

  const handleTogglePause = useCallback(async () => {
    if (!data) return;
    if (data.status.tradingPaused) {
      await api.resumeTrading();
    } else {
      await api.pauseTrading();
    }
    refresh();
  }, [data, refresh]);

  if (loading && !data) return <Connecting />;
  if (error && !data) return <ConnectError error={error} />;
  if (!data) return null;

  const tabs: TabDef[] = [
    { id: 'overview',   label: 'Overview' },
    { id: 'positions',  label: 'Positions', badge: data.positions.length },
    { id: 'journal',    label: 'Journal', badge: outcomesData?.stats.totalTrades },
    { id: 'feed',       label: 'Feed' },
    { id: 'settings',  label: 'Settings' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-primary)]">
      {/* ── Always-visible status bar ── */}
      <StatusIndicator
        botRunning={data.status.botRunning}
        tradingPaused={data.status.tradingPaused}
        marketState={data.status.marketState}
        lastHeartbeat={data.status.lastHeartbeat}
        nextPulse={data.status.nextPulse}
        botMood={data.status.botMood}
        tokenUsage={data.status.tokenUsage}
        portfolioValue={data.portfolio.value}
        dailyPL={data.portfolio.dailyPL}
        dailyPLPercent={data.portfolio.dailyPLPercent}
        onTogglePause={handleTogglePause}
      />

      {/* ── Tab navigation ── */}
      <TabBar
        tabs={tabs}
        active={activeTab}
        onSelect={setActiveTab}
        stale={!!error}
      />

      {/* ── Tab content ── */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'overview'  && <OverviewTab data={data} />}
        {activeTab === 'positions' && <PositionsTab data={data} />}
        {activeTab === 'journal'   && <JournalTab outcomesData={outcomesData ?? null} />}
        {activeTab === 'feed'      && <FeedTab data={data} />}
        {activeTab === 'settings'  && <SettingsTab />}
      </main>
    </div>
  );
}

export default App;
