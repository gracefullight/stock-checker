import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { marketRoutes } from '@/routes/market';

vi.mock('@stock-checker/core/src/services/data-fetcher', () => ({
  getFearGreedIndex: vi.fn(),
}));

import { getFearGreedIndex } from '@stock-checker/core/src/services/data-fetcher';

const mockedGetFearGreedIndex = vi.mocked(getFearGreedIndex);

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
});
