import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cached, cacheSize, clearCache } from '@/lib/cache';

describe('cached', () => {
  beforeEach(() => {
    clearCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the cached value within the TTL without re-calling fn', async () => {
    const fn = vi.fn().mockResolvedValue('a');

    await expect(cached('k', 1000, fn)).resolves.toBe('a');
    await expect(cached('k', 1000, fn)).resolves.toBe('a');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after the TTL expires', async () => {
    const fn = vi.fn().mockResolvedValueOnce('a').mockResolvedValueOnce('b');

    await expect(cached('k', 1000, fn)).resolves.toBe('a');
    vi.advanceTimersByTime(1001);
    await expect(cached('k', 1000, fn)).resolves.toBe('b');

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('dedups concurrent in-flight calls for the same key', async () => {
    let resolve!: (v: string) => void;
    const fn = vi.fn(() => new Promise<string>((r) => (resolve = r)));

    const p1 = cached('k', 1000, fn);
    const p2 = cached('k', 1000, fn);
    resolve('shared');

    await expect(p1).resolves.toBe('shared');
    await expect(p2).resolves.toBe('shared');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('evicts the entry when fn rejects so the next call retries', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');

    await expect(cached('k', 1000, fn)).rejects.toThrow('boom');
    await expect(cached('k', 1000, fn)).resolves.toBe('ok');

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('keeps empty results only for the short empty TTL', async () => {
    const fn = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('real');
    const opts = { isEmpty: (v: unknown) => v === null, emptyTtlMs: 500 };

    await expect(cached('k', 60_000, fn, opts)).resolves.toBeNull();
    vi.advanceTimersByTime(501);
    await expect(cached('k', 60_000, fn, opts)).resolves.toBe('real');

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clearCache empties the store', async () => {
    await cached('k', 1000, () => Promise.resolve(1));
    expect(cacheSize()).toBe(1);
    clearCache();
    expect(cacheSize()).toBe(0);
  });
});
