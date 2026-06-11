import {
  fetchBenchmarkPrices,
  getHistoricalPrices,
  getQuoteSnapshots,
  type QuoteSnapshot,
} from '@stock-checker/core/src/services/data-fetcher';
import { cacheStore, MINUTE, ttlUnlessEmpty } from '@/lib/cache';

// Daily candles tolerate minutes of staleness; the long backtest windows are
// effectively immutable intraday, so they tolerate an hour.
const QUOTES_TTL = 5 * MINUTE;
const OHLCV_TTL = 10 * MINUTE;
const BACKTEST_TTL = 60 * MINUTE;

const cache = cacheStore
  .define(
    'quotes',
    {
      serialize: (tickers: string[]) => [...tickers].sort().join(','),
      ttl: ttlUnlessEmpty(QUOTES_TTL, (v) => !v || Object.keys(v).length === 0),
    },
    (tickers: string[]) => getQuoteSnapshots(tickers)
  )
  .define(
    'ohlcv',
    { ttl: ttlUnlessEmpty(OHLCV_TTL, (v) => !v || v.length === 0) },
    ({ ticker, days }: { ticker: string; days: number }) => getHistoricalPrices(ticker, days)
  )
  .define(
    'btprices',
    { ttl: ttlUnlessEmpty(BACKTEST_TTL, (v) => !v || v.length === 0) },
    ({ ticker, days }: { ticker: string; days: number }) => getHistoricalPrices(ticker, days)
  )
  .define(
    'bench',
    { ttl: ttlUnlessEmpty(BACKTEST_TTL, (v) => !v || v.length === 0) },
    ({ symbol, days }: { symbol: string; days: number }) => fetchBenchmarkPrices(symbol, days)
  );

export function cachedQuoteSnapshots(tickers: string[]): Promise<Record<string, QuoteSnapshot>> {
  return cache.quotes(tickers);
}

export function cachedHistoricalPrices(ticker: string, days: number) {
  return cache.ohlcv({ ticker, days });
}

export function cachedBacktestPrices(ticker: string, days: number) {
  return cache.btprices({ ticker, days });
}

export function cachedBenchmarkPrices(symbol: string, days: number) {
  return cache.bench({ symbol, days });
}
