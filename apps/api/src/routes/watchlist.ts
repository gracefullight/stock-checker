import { addTicker, getWatchlist, removeTicker } from '@stock-checker/core/src/watchlist/manager';
import type { FastifyPluginAsync } from 'fastify';

interface TickerParams {
  ticker: string;
}

export const watchlistRoutes: FastifyPluginAsync = async (app) => {
  app.get('/watchlist', async (req, reply) => {
    try {
      const watchlist = await getWatchlist();
      return reply.send(watchlist);
    } catch (error) {
      req.log.error({ err: error }, 'get watchlist failed');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.post<{ Params: TickerParams }>('/watchlist/:ticker', async (req, reply) => {
    try {
      const ticker = req.params.ticker.toUpperCase();
      await addTicker(ticker);
      return reply.status(201).send({ success: true });
    } catch (error) {
      req.log.error({ err: error }, 'add watchlist ticker failed');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.delete<{ Params: TickerParams }>('/watchlist/:ticker', async (req, reply) => {
    try {
      const ticker = req.params.ticker.toUpperCase();
      await removeTicker(ticker);
      return reply.send({ success: true });
    } catch (error) {
      req.log.error({ err: error }, 'remove watchlist ticker failed');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
};
