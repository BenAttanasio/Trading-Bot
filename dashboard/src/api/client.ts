const BASE_URL = '/api';

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `API error: ${res.status}`);
  }
  return res.json();
}

export const api = {
  getDashboard: () => fetchApi<any>('/dashboard'),
  getPortfolio: () => fetchApi<any>('/portfolio'),
  getTrades: (limit = 50) => fetchApi<any>(`/trades?limit=${limit}`),
  getTradesToday: () => fetchApi<any>('/trades/today'),
  getResearch: (limit = 20) => fetchApi<any>(`/research?limit=${limit}`),
  getResearchForSymbol: (symbol: string) => fetchApi<any>(`/research/${symbol}`),
  getAlerts: (limit = 50) => fetchApi<any>(`/alerts?limit=${limit}`),
  getConfig: () => fetchApi<any>('/config'),
  getWatchlist: () => fetchApi<any>('/watchlist'),

  getOutcomes: () => fetchApi<any>('/outcomes'),

  pauseTrading: () => fetchApi<any>('/config/pause', { method: 'POST' }),
  resumeTrading: () => fetchApi<any>('/config/resume', { method: 'POST' }),

  addToWatchlist: (symbol: string, sector?: string, reason?: string) =>
    fetchApi<any>('/watchlist', {
      method: 'POST',
      body: JSON.stringify({ symbol, sector, reason }),
    }),

  removeFromWatchlist: (symbol: string) =>
    fetchApi<any>(`/watchlist/${symbol}`, { method: 'DELETE' }),
};
