import { alpacaRequest } from './client';
import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('AlpacaNews');

export interface AlpacaNewsItem {
  id: number;
  headline: string;
  summary: string;
  author: string;
  created_at: string;
  updated_at: string;
  url: string;
  symbols: string[];
  source: string;
}

export async function getNews(
  symbols?: string[],
  limit: number = 10,
  start?: string,
  end?: string
): Promise<AlpacaNewsItem[]> {
  const params: Record<string, string> = {
    limit: limit.toString(),
    sort: 'desc',
  };

  if (symbols && symbols.length > 0) {
    params.symbols = symbols.join(',');
  }
  if (start) params.start = start;
  if (end) params.end = end;

  try {
    const response = await alpacaRequest<{ news: AlpacaNewsItem[] }>('/v1beta1/news', {
      useDataUrl: true,
      params,
    });
    return response.news || [];
  } catch (error) {
    log.error('Failed to fetch news', { error, symbols });
    return [];
  }
}

export async function getNewsForSymbol(symbol: string, limit: number = 5): Promise<AlpacaNewsItem[]> {
  return getNews([symbol], limit);
}

export async function getLatestNews(limit: number = 20): Promise<AlpacaNewsItem[]> {
  return getNews(undefined, limit);
}
