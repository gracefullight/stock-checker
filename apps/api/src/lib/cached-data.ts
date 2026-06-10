import {
  fetchBenchmarkPrices,
  getFearGreedIndex,
  getHistoricalPrices,
  getQuoteSnapshots,
  type QuoteSnapshot,
} from '@stock-checker/core/src/services/data-fetcher';
import { getDividendInfo } from '@stock-checker/core/src/services/dividends';
import { getEarningsData } from '@stock-checker/core/src/services/earnings';
import { getFundamentals } from '@stock-checker/core/src/services/fundamentals';
import { getStockNews } from '@stock-checker/core/src/services/news';
import { analyzeTicker } from '@/lib/analyze';
import { cached } from '@/lib/cache';

// TTLs for the Yahoo-backed data. Daily-candle analysis tolerates minutes of
// staleness; reference data (fundamentals/earnings/dividends) tolerates an hour.
const MINUTE = 60_000;
export const TTL = {
  analyze: 10 * MINUTE,
  quotes: 5 * MINUTE,
  ohlcv: 10 * MINUTE,
  backtestData: 60 * MINUTE,
  fundamentals: 60 * MINUTE,
  earnings: 60 * MINUTE,
  dividends: 60 * MINUTE,
  news: 10 * MINUTE,
  fearGreed: 30 * MINUTE,
} as const;

export function cachedAnalyzeTicker(ticker: string, fearGreed: number | null) {
  // fearGreed is baked into the cached result; it has its own 30m cache so
  // entries stay consistent within a window.
  return cached(`analyze:${ticker}`, TTL.analyze, () => analyzeTicker(ticker, fearGreed), {
    isEmpty: (v) => v == null,
  });
}

export function cachedQuoteSnapshots(tickers: string[]): Promise<Record<string, QuoteSnapshot>> {
  const key = `quotes:${[...tickers].sort().join(',')}`;
  return cached(key, TTL.quotes, () => getQuoteSnapshots(tickers), {
    isEmpty: (v) => !v || Object.keys(v).length === 0,
  });
}

export function cachedHistoricalPrices(ticker: string, days: number) {
  return cached(`ohlcv:${ticker}:${days}`, TTL.ohlcv, () => getHistoricalPrices(ticker, days), {
    isEmpty: (v) => !v || v.length === 0,
  });
}

export function cachedBacktestPrices(ticker: string, days: number) {
  return cached(
    `btprices:${ticker}:${days}`,
    TTL.backtestData,
    () => getHistoricalPrices(ticker, days),
    { isEmpty: (v) => !v || v.length === 0 }
  );
}

export function cachedBenchmarkPrices(symbol: string, days: number) {
  return cached(
    `bench:${symbol}:${days}`,
    TTL.backtestData,
    () => fetchBenchmarkPrices(symbol, days),
    { isEmpty: (v) => !v || v.length === 0 }
  );
}

export function cachedFundamentals(ticker: string) {
  return cached(`fundamentals:${ticker}`, TTL.fundamentals, () => getFundamentals(ticker));
}

export function cachedEarnings(ticker: string) {
  return cached(`earnings:${ticker}`, TTL.earnings, () => getEarningsData(ticker));
}

export function cachedDividends(ticker: string) {
  return cached(`dividends:${ticker}`, TTL.dividends, () => getDividendInfo(ticker));
}

export function cachedNews(ticker: string, limit = 5) {
  return cached(`news:${ticker}:${limit}`, TTL.news, () => getStockNews(ticker, limit), {
    isEmpty: (v) => !v || v.length === 0,
  });
}

export function cachedFearGreed(): Promise<number | null> {
  return cached('fear-greed', TTL.fearGreed, () => getFearGreedIndex(), {
    isEmpty: (v) => v == null,
  });
}
