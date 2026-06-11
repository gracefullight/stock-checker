import {
  type FxRate,
  getFearGreedIndex,
  getFxRate,
} from '@stock-checker/core/src/services/data-fetcher';
import { cacheStore, MINUTE, ttlUnlessEmpty } from '@/lib/cache';

const FEAR_GREED_TTL = 30 * MINUTE;
const FX_TTL = 5 * MINUTE;

const cache = cacheStore
  .define('fearGreed', { ttl: ttlUnlessEmpty(FEAR_GREED_TTL, (v) => v == null) }, (_: null) =>
    getFearGreedIndex()
  )
  .define('fx', { ttl: ttlUnlessEmpty(FX_TTL, (v) => v == null) }, (currency: string) =>
    getFxRate(currency)
  );

export function cachedFearGreed(): Promise<number | null> {
  return cache.fearGreed(null);
}

export function cachedFxRate(currency: string): Promise<FxRate | null> {
  return cache.fx(currency);
}
