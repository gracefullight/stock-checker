import axios, { type AxiosRequestConfig, isAxiosError } from 'axios';
import { DateTime } from 'luxon';
import pino from 'pino';
import { fetchTiingoDaily, isTiingoConfigured } from '@/services/tiingo';
import yahooFinance, { fetchYahooDaily } from '@/services/yahoo-finance';
import type { BenchmarkCandle } from '@/types';

/**
 * Axios errors carry the full request config, including the Tiingo API token
 * in query params — censor it before it reaches log sinks (CI logs persist).
 */
export const LOG_REDACT_PATHS = ['error.config.params.token', 'err.config.params.token'];

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
  transport: { target: 'pino-pretty' },
});

const axiosInstance = axios.create({
  timeout: 30000,
  maxRedirects: 5,
});

axiosInstance.interceptors.response.use(undefined, async (error) => {
  const config = error.config as AxiosRequestConfig & { __retryCount?: number };
  config.__retryCount = config.__retryCount ?? 0;

  if (config.__retryCount < 3 && shouldRetry(error)) {
    config.__retryCount++;
    const delay = 1000 * 2 ** (config.__retryCount - 1);
    await new Promise((r) => setTimeout(r, delay));
    return axiosInstance(config);
  }
  return Promise.reject(error);
});

function shouldRetry(error: unknown): boolean {
  if (isAxiosError(error)) {
    return !error.response || (error.response.status >= 500 && error.response.status < 600);
  }
  return false;
}

export async function getHistoricalPrices(symbol: string, daysAgo = 365) {
  const end = DateTime.now();
  const start = end.minus({ days: daysAgo });

  try {
    const rows = await fetchYahooDaily(symbol, start.toJSDate(), end.toJSDate());
    if (rows.length > 0) return rows;
    logger.warn({ symbol }, 'Yahoo returned no historical prices');
  } catch (error) {
    logger.error({ error, symbol }, 'Failed to fetch historical prices from Yahoo');
  }

  // Fallback: Tiingo daily candles when a key is provisioned (Yahoo rate-limits
  // aggressively); without a key, degrade to [] as before.
  if (isTiingoConfigured()) {
    try {
      return await fetchTiingoDaily(symbol, daysAgo);
    } catch (error) {
      logger.error({ error, symbol }, 'Tiingo fallback failed');
    }
  }
  return [];
}

const benchmarkCache = new Map<string, BenchmarkCandle[]>();

export async function fetchBenchmarkPrices(
  symbol: string,
  daysAgo = 730
): Promise<BenchmarkCandle[]> {
  if (benchmarkCache.has(symbol)) return benchmarkCache.get(symbol)!;
  const raw = await getHistoricalPrices(symbol, daysAgo);
  const candles: BenchmarkCandle[] = raw.map((d) => ({
    date: d.date,
    close: d.adjClose ?? d.close,
    volume: d.volume,
    high: d.high,
    low: d.low,
  }));
  benchmarkCache.set(symbol, candles);
  return candles;
}

export async function getFearGreedIndex(): Promise<number | null> {
  try {
    const res = await axiosInstance.get('https://api.alternative.me/fng/?limit=1&format=json');
    const value = parseInt(res.data?.data?.[0]?.value, 10);
    return Number.isNaN(value) ? null : value;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch fear/greed index');
    return null;
  }
}

export interface QuoteSnapshot {
  name: string;
  marketCap: number | null;
  dayChangePct: number | null;
}

/**
 * Batch-fetch name + market cap + day change for a list of symbols in a single
 * quote() request. Non-critical: returns whatever resolves, {} on failure.
 */
export async function getQuoteSnapshots(symbols: string[]): Promise<Record<string, QuoteSnapshot>> {
  if (symbols.length === 0) return {};
  try {
    const quotes = await yahooFinance.quote(symbols);
    const list = Array.isArray(quotes) ? quotes : [quotes];
    const snapshots: Record<string, QuoteSnapshot> = {};
    for (const q of list) {
      if (q?.symbol) {
        snapshots[q.symbol] = {
          name: q.longName ?? q.shortName ?? q.symbol,
          marketCap: q.marketCap ?? null,
          dayChangePct: q.regularMarketChangePercent ?? null,
        };
      }
    }
    return snapshots;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch quote snapshots');
    return {};
  }
}

export async function getQuoteNames(symbols: string[]): Promise<Record<string, string>> {
  const snapshots = await getQuoteSnapshots(symbols);
  return Object.fromEntries(Object.entries(snapshots).map(([sym, s]) => [sym, s.name]));
}

export interface FxRate {
  /** ISO-4217 quote currency, e.g. 'KRW' for USD→KRW. */
  currency: string;
  /** Units of `currency` per 1 USD. */
  rate: number;
  prevClose: number | null;
  dayChangePct: number | null;
  /** Quote timestamp (ISO-8601), market time when Yahoo provides it. */
  asOf: string;
}

/**
 * USD→currency spot rate via Yahoo's FX quote symbols (`USDKRW=X`).
 * Returns null when the pair is unknown or the quote has no price.
 */
export async function getFxRate(currency: string): Promise<FxRate | null> {
  try {
    const result = await yahooFinance.quote(`USD${currency}=X`);
    const quote = Array.isArray(result) ? result[0] : result;
    const rate = quote?.regularMarketPrice;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
    const marketTime = quote.regularMarketTime;
    return {
      currency,
      rate,
      prevClose: quote.regularMarketPreviousClose ?? null,
      dayChangePct: quote.regularMarketChangePercent ?? null,
      asOf: (marketTime instanceof Date ? marketTime : new Date()).toISOString(),
    };
  } catch (error) {
    logger.error({ error, currency }, 'Failed to fetch FX rate');
    return null;
  }
}
