import type { TickerResult } from '@stock-checker/core/src/types';
import axios, { type AxiosError } from 'axios';

// Server components can use the non-public env var to avoid exposing internal
// addresses. Clients only see NEXT_PUBLIC_* so the fallback chain is:
//   process.env.API_URL (server-only)  →  process.env.NEXT_PUBLIC_API_URL  →  localhost
const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type { TickerResult };

export interface FearGreedResult {
  value: number;
  label: string;
  timestamp: Date;
}

export interface TickerDetailResult extends TickerResult {
  fundamentals?: Record<string, unknown>;
  news?: Array<{ title: string; url: string; publishedAt: string }>;
  earnings?: Record<string, unknown>;
}

export interface OHLCVCandle {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  gaussianMid: number;
  gaussianUpper: number;
  gaussianLower: number;
  gaussianGreen: boolean;
  signal: 'BUY' | 'SELL' | 'HOLD' | null;
}

const instance = axios.create({
  baseURL: API_URL,
  // Upstream (yahoo-finance: fundamentals + earnings + OHLCV) routinely needs
  // well over 10s; keep a generous ceiling so detail/portfolio pages don't
  // false-timeout while still bounding genuinely hung requests.
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

instance.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response) {
      const { status, statusText } = error.response;
      throw new Error(`API error ${status}: ${statusText}`);
    }
    // Network error, timeout, or request setup failure
    throw new Error(`API error: ${error.message}`);
  }
);

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await instance.request<T>({
    url: path,
    method: init?.method as string | undefined,
    headers: init?.headers as Record<string, string> | undefined,
  });
  return response.data;
}

/**
 * GET /api/screener?tickers=AAPL,TSLA,NVDA
 */
export async function getScreener(tickers: string[]): Promise<TickerResult[]> {
  const params = new URLSearchParams({ tickers: tickers.join(',') });
  const res = await apiFetch<{ results: TickerResult[] }>(`/api/screener?${params.toString()}`);
  return res.results;
}

/**
 * GET /api/screener/:ticker?include=fundamentals,news,earnings
 */
export function getTickerDetail(
  ticker: string,
  include: string[] = ['fundamentals', 'earnings']
): Promise<TickerDetailResult> {
  const params = new URLSearchParams({ include: include.join(',') });
  return apiFetch<TickerDetailResult>(
    `/api/screener/${encodeURIComponent(ticker)}?${params.toString()}`
  );
}

/**
 * GET /api/market/fear-greed
 */
export function getFearGreed(): Promise<FearGreedResult> {
  return apiFetch<FearGreedResult>('/api/market/fear-greed');
}

/**
 * GET /api/portfolio
 */
export async function getPortfolio(): Promise<string[]> {
  const res = await apiFetch<{ assets: string[]; createdAt: string }>('/api/portfolio');
  return res.assets;
}

/**
 * POST /api/portfolio/:ticker
 */
export function addToPortfolio(ticker: string): Promise<void> {
  return apiFetch<void>(`/api/portfolio/${encodeURIComponent(ticker)}`, { method: 'POST' });
}

/**
 * DELETE /api/portfolio/:ticker
 */
export function removeFromPortfolio(ticker: string): Promise<void> {
  return apiFetch<void>(`/api/portfolio/${encodeURIComponent(ticker)}`, { method: 'DELETE' });
}

/**
 * GET /api/screener/:ticker/ohlcv?days=180
 */
export function getOHLCV(ticker: string, days = 180): Promise<OHLCVCandle[]> {
  return apiFetch<OHLCVCandle[]>(`/api/screener/${encodeURIComponent(ticker)}/ohlcv?days=${days}`);
}
