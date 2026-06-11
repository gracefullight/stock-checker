import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { marketRoutes } from '@/routes/market';

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

import { getFearGreedIndex, getFxRate } from '@stock-checker/core/src/services/data-fetcher';
import { clearCache } from '@/lib/cache';

const mockedGetFearGreedIndex = vi.mocked(getFearGreedIndex);
const mockedGetFxRate = vi.mocked(getFxRate);

async function build() {
  const app = Fastify({ logger: false });
  await app.register(marketRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

describe('marketRoutes', () => {
  let app: Awaited<ReturnType<typeof build>>;

  beforeEach(async () => {
    app = await build();
    vi.resetAllMocks();
    clearCache();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/market/fear-greed', () => {
    it('returns 200 with value and label for a greed value', async () => {
      mockedGetFearGreedIndex.mockResolvedValue(72);

      const res = await app.inject({ method: 'GET', url: '/api/market/fear-greed' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ value: 72, label: 'Greed' });
    });

    it('returns correct label for extreme fear value', async () => {
      mockedGetFearGreedIndex.mockResolvedValue(10);

      const res = await app.inject({ method: 'GET', url: '/api/market/fear-greed' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ value: 10, label: 'Extreme Fear' });
    });

    it('returns Unknown label when value is null', async () => {
      mockedGetFearGreedIndex.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/api/market/fear-greed' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ value: null, label: 'Unknown' });
    });

    it('returns 500 when getFearGreedIndex rejects', async () => {
      mockedGetFearGreedIndex.mockRejectedValue(new Error('network error'));

      const res = await app.inject({ method: 'GET', url: '/api/market/fear-greed' });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'Internal server error' });
    });
  });

  describe('GET /api/market/fx', () => {
    const krwRate = {
      currency: 'KRW',
      rate: 1385.5,
      prevClose: 1380.2,
      dayChangePct: 0.38,
      asOf: '2026-06-11T05:00:00.000Z',
    };

    it('defaults to KRW when no currency is given', async () => {
      mockedGetFxRate.mockResolvedValue(krwRate);

      const res = await app.inject({ method: 'GET', url: '/api/market/fx' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(krwRate);
      expect(mockedGetFxRate).toHaveBeenCalledWith('KRW');
    });

    it('serves a requested currency case-insensitively', async () => {
      mockedGetFxRate.mockResolvedValue({ ...krwRate, currency: 'JPY', rate: 155.2 });

      const res = await app.inject({ method: 'GET', url: '/api/market/fx?currency=jpy' });

      expect(res.statusCode).toBe(200);
      expect(res.json().currency).toBe('JPY');
      expect(mockedGetFxRate).toHaveBeenCalledWith('JPY');
    });

    it('rejects an unsupported currency with 400', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/market/fx?currency=DOGE' });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('DOGE');
      expect(mockedGetFxRate).not.toHaveBeenCalled();
    });

    it('returns 502 when the rate is unavailable', async () => {
      mockedGetFxRate.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/api/market/fx?currency=KRW' });

      expect(res.statusCode).toBe(502);
    });
  });
});
