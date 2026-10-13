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
    vi.stubEnv('CORS_ORIGIN', undefined);
    app = await build();
    vi.resetAllMocks();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
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

    it('accepts the dashboard origin', async () => {
      mockedAddAsset.mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/portfolio/aapl',
        headers: { origin: 'http://localhost:5100' },
      });

      expect(res.statusCode).toBe(201);
    });

    it.each(['brk-b', '005930.KS', '^GSPC'])('accepts market symbol %s', async (ticker) => {
      mockedAddAsset.mockResolvedValue(undefined);

      const res = await app.inject({ method: 'POST', url: `/api/portfolio/${ticker}` });

      expect(res.statusCode).toBe(201);
      expect(mockedAddAsset).toHaveBeenCalledWith(ticker.toUpperCase());
    });

    it.each(['AAPL,MSFT', 'A'.repeat(33), 'AAPL..B', 'AAPL%20x'])(
      'rejects an invalid ticker before touching the store: %s',
      async (ticker) => {
        const res = await app.inject({ method: 'POST', url: `/api/portfolio/${ticker}` });

        expect(res.statusCode).toBe(400);
        expect(mockedAddAsset).not.toHaveBeenCalled();
      }
    );
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

  describe('write guard', () => {
    it.each([
      { method: 'POST' as const, operation: mockedAddAsset },
      { method: 'DELETE' as const, operation: mockedRemoveAsset },
    ])('rejects a cross-site browser $method before mutating', async ({ method, operation }) => {
      const res = await app.inject({
        method,
        url: '/api/portfolio/AAPL',
        headers: { origin: 'https://untrusted.invalid' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain('allowed origin: http://localhost:5100');
      expect(operation).not.toHaveBeenCalled();
    });

    it.each([
      { method: 'POST' as const, operation: mockedAddAsset },
      { method: 'DELETE' as const, operation: mockedRemoveAsset },
    ])(
      'rejects an Origin-less $method from a non-loopback client',
      async ({ method, operation }) => {
        const res = await app.inject({
          method,
          url: '/api/portfolio/AAPL',
          remoteAddress: '192.168.1.20',
        });

        expect(res.statusCode).toBe(403);
        expect(res.json().error).toContain('from this machine only');
        expect(operation).not.toHaveBeenCalled();
      }
    );

    it('still allows a non-loopback dashboard browser when CORS_ORIGIN names it', async () => {
      vi.stubEnv('CORS_ORIGIN', 'http://192.168.1.10:5100');
      mockedAddAsset.mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/portfolio/AAPL',
        headers: { origin: 'http://192.168.1.10:5100' },
        remoteAddress: '192.168.1.20',
      });

      expect(res.statusCode).toBe(201);
      expect(mockedAddAsset).toHaveBeenCalledWith('AAPL');
    });

    it('leaves reads open to Origin-less non-loopback clients', async () => {
      mockedGetPortfolio.mockResolvedValue({ assets: [], createdAt: 'x' } as never);

      const res = await app.inject({
        method: 'GET',
        url: '/api/portfolio',
        remoteAddress: '192.168.1.20',
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
