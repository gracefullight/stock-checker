import { createCache } from 'async-cache-dedupe';

export const MINUTE = 60;

/**
 * Core fetchers swallow upstream errors into null/[]/{} — pinning those for
 * the full TTL would mask recovery, so empty results live only this long.
 */
export const EMPTY_TTL = MINUTE;

/** Per-result TTL: full TTL for real data, EMPTY_TTL for empty results. */
export function ttlUnlessEmpty<T>(fullTtl: number, isEmpty: (v: T) => boolean): (v: T) => number {
  return (v) => (isEmpty(v) ? EMPTY_TTL : fullTtl);
}

/**
 * Shared TTL cache + in-flight dedup store (async-cache-dedupe): concurrent
 * callers of the same key share one upstream call — Yahoo rate limits are the
 * whole reason this layer exists. Rejections are deduped but never stored.
 *
 * This module owns only the store; each domain module under `lib/cached/`
 * imports it and `define()`s its own cached methods (TTLs live with the
 * domain, infrastructure lives here).
 */
export const cacheStore = createCache({
  ttl: 0, // no default — every define sets its own
  storage: { type: 'memory', options: { size: 500 } },
});

/** Test helper: drop every cached entry across all defines. */
export function clearCache(): Promise<void> {
  return cacheStore.clear();
}
