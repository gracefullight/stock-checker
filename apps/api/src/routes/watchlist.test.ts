import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watchlistRoutes } from '@/routes/watchlist';

vi.mock('@stock-checker/core/src/watchlist/manager', () => ({
  getWatchlist: vi.fn(),
  addTicker: vi.fn(),
  removeTicker: vi.fn(),
}));

import { addTicker, getWatchlist, removeTicker } from '@stock-checker/core/src/watchlist/manager';

const mockedGetWatchlist = vi.mocked(getWatchlist);
const mockedAddTicker = vi.mocked(addTicker);
const mockedRemoveTicker = vi.mocked(removeTicker);

async function build() {
  const app = Fastify({ logger: false });
  await app.register(watchlistRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

describe('watchlistRoutes', () => {
  let app: Awaited<ReturnType<typeof build>>;

  beforeEach(async () => {
    app = await build();
    vi.resetAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/watchlist', () => {
    it('returns 200 with the watchlist object', async () => {
      const mockWatchlist = { tickers: ['AAPL'], createdAt: 'x' };
      mockedGetWatchlist.mockResolvedValue(mockWatchlist as never);

      const res = await app.inject({ method: 'GET', url: '/api/watchlist' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockWatchlist);
    });

    it('returns 500 when getWatchlist rejects', async () => {
      mockedGetWatchlist.mockRejectedValue(new Error('fs error'));

      const res = await app.inject({ method: 'GET', url: '/api/watchlist' });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'Internal server error' });
    });
  });

  describe('POST /api/watchlist/:ticker', () => {
    it('returns 201 and calls addTicker with uppercased ticker', async () => {
      mockedAddTicker.mockResolvedValue(undefined);

      const res = await app.inject({ method: 'POST', url: '/api/watchlist/nvda' });

      expect(res.statusCode).toBe(201);
      expect(mockedAddTicker).toHaveBeenCalledWith('NVDA');
    });

    it('returns 500 when addTicker rejects', async () => {
      mockedAddTicker.mockRejectedValue(new Error('fs error'));

      const res = await app.inject({ method: 'POST', url: '/api/watchlist/NVDA' });

      expect(res.statusCode).toBe(500);
    });
  });

  describe('DELETE /api/watchlist/:ticker', () => {
    it('returns 200 and calls removeTicker with uppercased ticker', async () => {
      mockedRemoveTicker.mockResolvedValue(undefined);

      const res = await app.inject({ method: 'DELETE', url: '/api/watchlist/nvda' });

      expect(res.statusCode).toBe(200);
      expect(mockedRemoveTicker).toHaveBeenCalledWith('NVDA');
    });

    it('returns 500 when removeTicker rejects', async () => {
      mockedRemoveTicker.mockRejectedValue(new Error('fs error'));

      const res = await app.inject({ method: 'DELETE', url: '/api/watchlist/NVDA' });

      expect(res.statusCode).toBe(500);
    });
  });
});
