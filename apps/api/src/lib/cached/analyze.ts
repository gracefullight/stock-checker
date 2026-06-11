import { analyzeTicker } from '@/lib/analyze';
import { cacheStore, MINUTE, ttlUnlessEmpty } from '@/lib/cache';

// Daily-candle analysis tolerates minutes of staleness.
const ANALYZE_TTL = 10 * MINUTE;

const cache = cacheStore.define(
  'analyze',
  {
    // fearGreed is baked into the cached result; it has its own 30m cache so
    // entries stay consistent within a window — key on ticker only.
    serialize: (args: { ticker: string }) => args.ticker,
    ttl: ttlUnlessEmpty(ANALYZE_TTL, (v) => v == null),
  },
  ({ ticker, fearGreed }: { ticker: string; fearGreed: number | null }) =>
    analyzeTicker(ticker, fearGreed)
);

export function cachedAnalyzeTicker(ticker: string, fearGreed: number | null) {
  return cache.analyze({ ticker, fearGreed });
}
