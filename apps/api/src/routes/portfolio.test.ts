import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { portfolioRoutes } from '@/routes/portfolio';

vi.mock('@stock-checker/core/src/portfolio/manager', () => ({
  getPortfolio: vi.fn(),
  addAsset: vi.fn(),
  removeAsset: vi.fn(),
}));

import { addAsset, getPortfolio, removeAsset } from '@stock-checker/core/src/portfolio/manager';

const mockedGetPortfolio = vi.mocked(getPortfolio);
const mockedAddAsset = vi.mocked(addAsset);
const mockedRemoveAsset = vi.mocked(removeAsset);

async function build() {
  const app = Fastify({ logger: false });
  await app.register(portfolioRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

describe('portfolioRoutes', () => {
  let app: Awaited<ReturnType<typeof build>>;

  beforeEach(async () => {
    app = await build();
    vi.resetAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/portfolio', () => {
    it('returns 200 with the portfolio object', async () => {
      const mockPortfolio = { assets: ['AAPL'], createdAt: 'x' };
      mockedGetPortfolio.mockResolvedValue(mockPortfolio as never);

      const res = await app.inject({ method: 'GET', url: '/api/portfolio' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockPortfolio);
    });

    it('returns 500 when getPortfolio rejects', async () => {
      mockedGetPortfolio.mockRejectedValue(new Error('db error'));

      const res = await app.inject({ method: 'GET', url: '/api/portfolio' });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'Internal server error' });
    });
  });

  describe('POST /api/portfolio/:ticker', () => {
    it('returns 201, calls addAsset with uppercased ticker', async () => {
      mockedAddAsset.mockResolvedValue(undefined);

      const res = await app.inject({ method: 'POST', url: '/api/portfolio/aapl' });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ success: true });
      expect(mockedAddAsset).toHaveBeenCalledWith('AAPL');
    });
  });

  describe('DELETE /api/portfolio/:ticker', () => {
    it('returns 200, calls removeAsset with uppercased ticker', async () => {
      mockedRemoveAsset.mockResolvedValue(undefined);

      const res = await app.inject({ method: 'DELETE', url: '/api/portfolio/aapl' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(mockedRemoveAsset).toHaveBeenCalledWith('AAPL');
    });
  });
});
