import { env } from '../../config/env';
import { createServiceLogger } from '../../utils/logger';
import { TRADING_RULES } from '../../config/trading-rules';

const log = createServiceLogger('Alpaca');

interface AlpacaRequestOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PATCH';
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  useDataUrl?: boolean;
}

const headers = {
  'APCA-API-KEY-ID': env.ALPACA_API_KEY,
  'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY,
  'Content-Type': 'application/json',
};

export async function alpacaRequest<T>(
  path: string,
  options: AlpacaRequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, params, useDataUrl = false } = options;
  const baseUrl = useDataUrl ? env.ALPACA_DATA_URL : env.ALPACA_BASE_URL;

  let url = `${baseUrl}${path}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (body) {
    fetchOptions.body = JSON.stringify(body);
  }

  log.debug(`${method} ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TRADING_RULES.alpacaApiTimeoutMs);

  let response: Response;
  try {
    response = await fetch(url, { ...fetchOptions, signal: controller.signal });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Alpaca API timeout after ${TRADING_RULES.alpacaApiTimeoutMs}ms: ${method} ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    log.error(`Alpaca API error: ${response.status} ${response.statusText}`, {
      path,
      status: response.status,
      body: errorBody,
    });
    throw new Error(`Alpaca API error ${response.status}: ${errorBody}`);
  }

  // Some endpoints return empty body (e.g., DELETE)
  const text = await response.text();
  if (!text) return {} as T;

  return JSON.parse(text) as T;
}

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  last_equity: string;
  long_market_value: string;
  short_market_value: string;
  trading_blocked: boolean;
  account_blocked: boolean;
  pattern_day_trader: boolean;
  daytrade_count: number;
  shorting_enabled?: boolean;
}

export async function getAccount(): Promise<AlpacaAccount> {
  return alpacaRequest<AlpacaAccount>('/v2/account');
}

export async function verifyConnection(): Promise<boolean> {
  try {
    const account = await getAccount();
    log.info(`Connected to Alpaca: ${account.account_number} | Portfolio: $${account.portfolio_value} | Cash: $${account.cash}`);
    return true;
  } catch (error) {
    log.error('Failed to connect to Alpaca', { error });
    return false;
  }
}
