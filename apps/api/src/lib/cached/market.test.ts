import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@stock-checker/core/src/services/data-fetcher', () => ({
  getFearGreedIndex: vi.fn(),
  getHistoricalPrices: vi.fn(),
  fetchBenchmarkPrices: vi.fn(),
  getQuoteSnapshots: vi.fn(),
  getFxRate: vi.fn(),
}));
vi.mock('@stock-checker/core/src/services/dividends', () => ({ getDividendInfo: vi.fn() }));
vi.mock('@stock-checker/core/src/services/earnings', () => ({ getEarningsData: vi.fn() }));
vi.mock('@stock-checker/core/src/services/fundamentals', () => ({ getFundamentals: vi.fn() }));
vi.mock('@stock-checker/core/src/services/news', () => ({ getStockNews: vi.fn() }));
vi.mock('@/lib/analyze', () => ({ analyzeTicker: vi.fn() }));

import { getFxRate } from '@stock-checker/core/src/services/data-fetcher';
import { clearCache } from '@/lib/cache';
import { cachedFxRate } from '@/lib/cached/market';

const mockedGetFxRate = vi.mocked(getFxRate);

const krw = {
  currency: 'KRW',
  rate: 1385.5,
  prevClose: 1380.2,
  dayChangePct: 0.38,
  asOf: '2026-06-11T05:00:00.000Z',
};

describe('cached market data (async-cache-dedupe layer)', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await clearCache();
  });

  it('dedups concurrent in-flight calls into one upstream request', async () => {
    let resolve!: (v: typeof krw) => void;
    mockedGetFxRate.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );

    const p1 = cachedFxRate('KRW');
    const p2 = cachedFxRate('KRW');
    // The dedupe layer defers the upstream call to a microtask — wait for it.
    await vi.waitFor(() => expect(mockedGetFxRate).toHaveBeenCalled());
    resolve(krw);

    await expect(p1).resolves.toEqual(krw);
    await expect(p2).resolves.toEqual(krw);
    expect(mockedGetFxRate).toHaveBeenCalledTimes(1);
  });

  it('serves repeat calls from cache within the TTL', async () => {
    mockedGetFxRate.mockResolvedValue(krw);

    await cachedFxRate('KRW');
    await cachedFxRate('KRW');

    expect(mockedGetFxRate).toHaveBeenCalledTimes(1);
  });

  it('keys entries by argument — different currencies fetch separately', async () => {
    mockedGetFxRate.mockResolvedValue(krw);

    await cachedFxRate('KRW');
    await cachedFxRate('JPY');

    expect(mockedGetFxRate).toHaveBeenCalledTimes(2);
  });

  it('does not cache rejections', async () => {
    mockedGetFxRate.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(krw);

    await expect(cachedFxRate('KRW')).rejects.toThrow('boom');
    await expect(cachedFxRate('KRW')).resolves.toEqual(krw);
    expect(mockedGetFxRate).toHaveBeenCalledTimes(2);
  });

  it('clearCache forces a refetch', async () => {
    mockedGetFxRate.mockResolvedValue(krw);

    await cachedFxRate('KRW');
    await clearCache();
    await cachedFxRate('KRW');

    expect(mockedGetFxRate).toHaveBeenCalledTimes(2);
  });
});
