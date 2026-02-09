export interface WatchlistEntry {
  symbol: string;
  sector: string;
  reason: string;
  addedAt: Date;
  active: boolean;
}

// Default seed watchlist — diversified across sectors
export const DEFAULT_WATCHLIST: Omit<WatchlistEntry, 'addedAt' | 'active'>[] = [
  // Technology
  { symbol: 'AAPL', sector: 'Technology', reason: 'Mega-cap tech, strong ecosystem and services growth' },
  { symbol: 'MSFT', sector: 'Technology', reason: 'Cloud + AI leader, enterprise moat' },
  { symbol: 'NVDA', sector: 'Technology', reason: 'AI/GPU dominance, datacenter growth' },
  { symbol: 'GOOGL', sector: 'Technology', reason: 'Search + cloud + AI, advertising moat' },
  { symbol: 'META', sector: 'Technology', reason: 'Social media dominance, AI investment' },
  { symbol: 'AMD', sector: 'Technology', reason: 'CPU/GPU competitor, datacenter growth' },

  // Consumer
  { symbol: 'AMZN', sector: 'Consumer', reason: 'E-commerce + AWS + advertising' },
  { symbol: 'TSLA', sector: 'Consumer', reason: 'EV leader, high volatility momentum plays' },
  { symbol: 'COST', sector: 'Consumer', reason: 'Defensive retail, membership model' },

  // Healthcare
  { symbol: 'UNH', sector: 'Healthcare', reason: 'Insurance + Optum, steady grower' },
  { symbol: 'LLY', sector: 'Healthcare', reason: 'GLP-1 drug pipeline leader' },

  // Finance
  { symbol: 'JPM', sector: 'Finance', reason: 'Largest US bank, rate environment play' },
  { symbol: 'V', sector: 'Finance', reason: 'Payment network, global transaction growth' },

  // Energy
  { symbol: 'XOM', sector: 'Energy', reason: 'Oil major, dividend + buyback' },

  // Industrials
  { symbol: 'CAT', sector: 'Industrials', reason: 'Infrastructure + construction cycle' },
];
