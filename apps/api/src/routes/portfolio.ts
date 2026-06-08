import { addAsset, getPortfolio, removeAsset } from '@stock-checker/core/src/portfolio/manager';
import type { FastifyPluginAsync } from 'fastify';

interface TickerParams {
  ticker: string;
}

export const portfolioRoutes: FastifyPluginAsync = async (app) => {
  app.get('/portfolio', async (req, reply) => {
    try {
      const portfolio = await getPortfolio();
      return reply.send(portfolio);
    } catch (error) {
      req.log.error({ err: error }, 'get portfolio failed');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.post<{ Params: TickerParams }>('/portfolio/:ticker', async (req, reply) => {
    try {
      const ticker = req.params.ticker.toUpperCase();
      await addAsset(ticker);
      return reply.status(201).send({ success: true });
    } catch (error) {
      req.log.error({ err: error }, 'add portfolio asset failed');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.delete<{ Params: TickerParams }>('/portfolio/:ticker', async (req, reply) => {
    try {
      const ticker = req.params.ticker.toUpperCase();
      await removeAsset(ticker);
      return reply.send({ success: true });
    } catch (error) {
      req.log.error({ err: error }, 'remove portfolio asset failed');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
};
