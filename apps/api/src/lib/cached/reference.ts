import { getDividendInfo } from '@stock-checker/core/src/services/dividends';
import { getEarningsData } from '@stock-checker/core/src/services/earnings';
import { getFundamentals } from '@stock-checker/core/src/services/fundamentals';
import { getStockNews } from '@stock-checker/core/src/services/news';
import { cacheStore, MINUTE, ttlUnlessEmpty } from '@/lib/cache';

// Reference data (fundamentals/earnings/dividends) tolerates an hour; news
// turns over faster.
const REFERENCE_TTL = 60 * MINUTE;
const NEWS_TTL = 10 * MINUTE;

const cache = cacheStore
  .define('fundamentals', { ttl: REFERENCE_TTL }, (ticker: string) => getFundamentals(ticker))
  .define('earnings', { ttl: REFERENCE_TTL }, (ticker: string) => getEarningsData(ticker))
  .define('dividends', { ttl: REFERENCE_TTL }, (ticker: string) => getDividendInfo(ticker))
  .define(
    'news',
    { ttl: ttlUnlessEmpty(NEWS_TTL, (v) => !v || v.length === 0) },
    ({ ticker, limit }: { ticker: string; limit: number }) => getStockNews(ticker, limit)
  );

export function cachedFundamentals(ticker: string) {
  return cache.fundamentals(ticker);
}

export function cachedEarnings(ticker: string) {
  return cache.earnings(ticker);
}

export function cachedDividends(ticker: string) {
  return cache.dividends(ticker);
}

export function cachedNews(ticker: string, limit = 5) {
  return cache.news({ ticker, limit });
}
