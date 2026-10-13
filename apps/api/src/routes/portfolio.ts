import { addAsset, getPortfolio, removeAsset } from '@stock-checker/core/src/portfolio/manager';
import type { FastifyPluginAsync } from 'fastify';
import { mutationGuardFor } from '@/lib/mutation-guard';

interface TickerParams {
  ticker: string;
}

export const TICKER_PARAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ticker'],
  properties: {
    ticker: {
      type: 'string',
      minLength: 1,
      maxLength: 32,
      pattern: '^\\^?[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*(?:=[A-Za-z0-9]+)?$',
    },
  },
} as const;

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

  app.post<{ Params: TickerParams }>(
    '/portfolio/:ticker',
    { schema: { params: TICKER_PARAM_SCHEMA }, onRequest: mutationGuardFor('add portfolio asset') },
    async (req, reply) => {
      try {
        const ticker = req.params.ticker.toUpperCase();
        await addAsset(ticker);
        return reply.status(201).send({ success: true });
      } catch (error) {
        req.log.error({ err: error }, 'add portfolio asset failed');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  app.delete<{ Params: TickerParams }>(
    '/portfolio/:ticker',
    {
      schema: { params: TICKER_PARAM_SCHEMA },
      onRequest: mutationGuardFor('remove portfolio asset'),
    },
    async (req, reply) => {
      try {
        const ticker = req.params.ticker.toUpperCase();
        await removeAsset(ticker);
        return reply.send({ success: true });
      } catch (error) {
        req.log.error({ err: error }, 'remove portfolio asset failed');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
};
