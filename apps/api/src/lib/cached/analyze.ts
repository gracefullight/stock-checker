import { analyzeTicker } from '@/lib/analyze';
import { cacheStore, MINUTE, ttlUnlessEmpty } from '@/lib/cache';

// Daily-candle analysis tolerates minutes of staleness.
const ANALYZE_TTL = 10 * MINUTE;

const cache = cacheStore.define(
  'analyze',
  {
    // The default key includes ticker and fearGreed, both of which affect the result.
    ttl: ttlUnlessEmpty(ANALYZE_TTL, (v) => v == null),
  },
  ({ ticker, fearGreed }: { ticker: string; fearGreed: number | null }) =>
    analyzeTicker(ticker, fearGreed)
);

export function cachedAnalyzeTicker(ticker: string, fearGreed: number | null) {
  return cache.analyze({ ticker, fearGreed });
}
