/**
 * Module-level TTL cache with in-flight dedup: the promise is stored
 * immediately, so concurrent callers of the same key share one upstream call
 * (Yahoo rate limits are the whole reason this layer exists).
 */
interface CacheEntry {
  value: Promise<unknown>;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

const SWEEP_THRESHOLD = 500;

function sweepExpired(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

export interface CachedOptions<T> {
  /** Treat the resolved value as "empty" (e.g. null / []) and keep it only for `emptyTtlMs`. */
  isEmpty?: (value: T) => boolean;
  /**
   * TTL for empty results (default 60s). Core fetchers swallow upstream errors
   * into null/[] — pinning those for the full TTL would mask recovery.
   */
  emptyTtlMs?: number;
}

export function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  options: CachedOptions<T> = {}
): Promise<T> {
  const now = Date.now();
  const existing = store.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.value as Promise<T>;
  }

  if (store.size >= SWEEP_THRESHOLD) sweepExpired(now);

  const entry: CacheEntry = {
    value: undefined as unknown as Promise<unknown>,
    expiresAt: now + ttlMs,
  };
  // Promise.resolve guards against fn() returning a bare value (e.g. unset mocks).
  const promise = Promise.resolve(fn()).then(
    (value) => {
      if (options.isEmpty?.(value)) {
        entry.expiresAt = now + (options.emptyTtlMs ?? 60_000);
      }
      return value;
    },
    (error) => {
      if (store.get(key) === entry) store.delete(key);
      throw error;
    }
  );
  entry.value = promise;
  store.set(key, entry);
  return promise;
}

export function clearCache(): void {
  store.clear();
}

export function cacheSize(): number {
  return store.size;
}
