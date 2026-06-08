import { getPortfolio } from '@stock-checker/core/src/portfolio/manager';
import { getFearGreedIndex, getHistoricalPrices } from '@stock-checker/core/src/services/data-fetcher';
import { getEarningsData } from '@stock-checker/core/src/services/earnings';
import { getFundamentals } from '@stock-checker/core/src/services/fundamentals';
import { getStockNews } from '@stock-checker/core/src/services/news';
import type { FastifyPluginAsync } from 'fastify';
import { analyzeTicker } from '@/lib/analyze';

interface ScreenerQuery {
  tickers?: string;
}

interface SingleTickerQuery {
  include?: string;
}

interface SingleTickerParams {
  ticker: string;
}

export const screenerRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ScreenerQuery }>('/screener', async (req, reply) => {
    try {
      let tickers: string[];

      if (req.query.tickers) {
        tickers = req.query.tickers
          .split(',')
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean);
      } else {
        const portfolio = await getPortfolio();
        tickers = portfolio.assets;
      }

      if (tickers.length === 0) {
        return reply.send({ results: [], fearGreed: null, generatedAt: new Date().toISOString() });
      }

      const fearGreed = await getFearGreedIndex();
      const settled = await Promise.allSettled(
        tickers.map((ticker) => analyzeTicker(ticker, fearGreed))
      );

      const results = settled
        .map((r) => (r.status === 'fulfilled' ? r.value : null))
        .filter((r) => r !== null);

      return reply.send({
        results,
        fearGreed,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      req.log.error({ err: error }, 'screener failed');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.get<{ Params: SingleTickerParams; Querystring: SingleTickerQuery }>(
    '/screener/:ticker',
    async (req, reply) => {
      try {
        const ticker = req.params.ticker.toUpperCase();
        const includeFields = req.query.include
          ? req.query.include.split(',').map((s) => s.trim())
          : [];

        const fearGreed = await getFearGreedIndex();
        const result = await analyzeTicker(ticker, fearGreed);

        if (!result) {
          return reply.status(404).send({ error: `No data found for ticker: ${ticker}` });
        }

        const extras: Record<string, unknown> = {};

        await Promise.all([
          includeFields.includes('fundamentals')
            ? getFundamentals(ticker).then((d) => {
                extras.fundamentals = d;
              })
            : Promise.resolve(),
          includeFields.includes('news')
            ? getStockNews(ticker, 5).then((d) => {
                extras.news = d;
              })
            : Promise.resolve(),
          includeFields.includes('earnings')
            ? getEarningsData(ticker).then((d) => {
                extras.earnings = d;
              })
            : Promise.resolve(),
        ]);

        return reply.send({ ...result, ...extras });
      } catch (error) {
        req.log.error({ err: error }, 'single screener failed');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  // GET /api/screener/:ticker/ohlcv?days=180
  app.get<{ Params: SingleTickerParams; Querystring: { days?: string } }>(
    '/screener/:ticker/ohlcv',
    async (req, reply) => {
      try {
        const ticker = req.params.ticker.toUpperCase();
        const days = Math.min(Number(req.query.days ?? 180), 730);
        const data = await getHistoricalPrices(ticker, days);
        return reply.send(
          data.map((d) => ({
            time: d.date.toISOString().split('T')[0],
            open: d.open ?? d.close,
            high: d.high ?? d.close,
            low: d.low ?? d.close,
            close: d.close,
            volume: d.volume ?? 0,
          }))
        );
      } catch (error) {
        req.log.error({ err: error }, 'ohlcv failed');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
};
