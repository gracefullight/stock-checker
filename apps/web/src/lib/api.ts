import type { TickerResult } from '@stock-checker/core/src/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

/**
 * GET /api/screener?tickers=AAPL,TSLA,NVDA
 */
export function getScreener(tickers: string[]): Promise<TickerResult[]> {
  const params = new URLSearchParams({ tickers: tickers.join(',') });
  return apiFetch<TickerResult[]>(`/api/screener?${params.toString()}`);
}

/**
 * GET /api/screener/:ticker?include=fundamentals,news,earnings
 */
export function getTickerDetail(
  ticker: string,
  include: string[] = ['fundamentals', 'earnings']
): Promise<TickerDetailResult> {
  const params = new URLSearchParams({ include: include.join(',') });
  return apiFetch<TickerDetailResult>(`/api/screener/${ticker}?${params.toString()}`);
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
export function getPortfolio(): Promise<string[]> {
  return apiFetch<string[]>('/api/portfolio');
}

/**
 * POST /api/portfolio/:ticker
 */
export function addToPortfolio(ticker: string): Promise<void> {
  return apiFetch<void>(`/api/portfolio/${ticker}`, { method: 'POST' });
}

/**
 * DELETE /api/portfolio/:ticker
 */
export function removeFromPortfolio(ticker: string): Promise<void> {
  return apiFetch<void>(`/api/portfolio/${ticker}`, { method: 'DELETE' });
}
