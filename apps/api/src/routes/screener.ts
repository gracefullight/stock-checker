import { SECTOR_ETF_MAP } from '@stock-checker/core/src/constants';
import { getPortfolio } from '@stock-checker/core/src/portfolio/manager';
import {
  fetchBenchmarkPrices,
  getFearGreedIndex,
  getHistoricalPrices,
  getQuoteSnapshots,
} from '@stock-checker/core/src/services/data-fetcher';
import { getDividendInfo } from '@stock-checker/core/src/services/dividends';
import { getEarningsData } from '@stock-checker/core/src/services/earnings';
import { getFundamentals } from '@stock-checker/core/src/services/fundamentals';
import { gaussianChannel } from '@stock-checker/core/src/services/gaussian-channel';
import { getStockNews } from '@stock-checker/core/src/services/news';
import { calcBB, calcSMA } from '@stock-checker/core/src/utils/chart-indicators';
import { getSignalHistory } from '@stock-checker/core/src/utils/signal-history';
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
      // Analysis (slow, per-ticker) and quote snapshot lookup (one batch call) run together.
      const [settled, snapshots] = await Promise.all([
        Promise.allSettled(tickers.map((ticker) => analyzeTicker(ticker, fearGreed))),
        getQuoteSnapshots(tickers),
      ]);

      const snapshotMap = snapshots ?? {};
      const results = settled
        .map((r) => (r.status === 'fulfilled' ? r.value : null))
        .filter((r) => r !== null)
        .map((r) => {
          const snap = snapshotMap[r.ticker];
          return {
            ...r,
            name: snap?.name ?? r.name,
            marketCap: snap?.marketCap ?? null,
            dayChangePct: snap?.dayChangePct ?? null,
          };
        });

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
          Promise.resolve(getQuoteSnapshots([ticker])).then((snaps) => {
            const snap = snaps?.[ticker];
            if (snap) {
              extras.name = snap.name;
              extras.marketCap = snap.marketCap;
              extras.dayChangePct = snap.dayChangePct;
            }
          }),
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
          includeFields.includes('dividends')
            ? getDividendInfo(ticker).then((d) => {
                extras.dividends = d;
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

  // GET /api/screener/:ticker/backtest-data?days=1825
  // Raw candles + benchmark series for the browser backtest playground.
  app.get<{ Params: SingleTickerParams; Querystring: { days?: string } }>(
    '/screener/:ticker/backtest-data',
    async (req, reply) => {
      try {
        const ticker = req.params.ticker.toUpperCase();
        const days = Math.min(Number(req.query.days ?? 1825), 1825);

        const toCandles = (
          data: Awaited<ReturnType<typeof getHistoricalPrices>>
        ): Array<{
          date: string;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
        }> =>
          data.map((d) => ({
            date: d.date.toISOString().split('T')[0],
            open: d.open ?? d.close,
            high: d.high ?? d.close,
            low: d.low ?? d.close,
            close: d.close,
            volume: d.volume ?? 0,
          }));

        const [data, spy, fund] = await Promise.all([
          getHistoricalPrices(ticker, days),
          fetchBenchmarkPrices('SPY', days),
          getFundamentals(ticker).catch(() => null),
        ]);

        if (data.length === 0) {
          return reply.status(404).send({ error: `No data found for ticker: ${ticker}` });
        }

        const sectorEtf = fund?.sector ? (SECTOR_ETF_MAP[fund.sector] ?? null) : null;
        const sectorCandles = sectorEtf ? await fetchBenchmarkPrices(sectorEtf, days) : [];

        return reply.send({
          ticker,
          candles: toCandles(data),
          spy: spy.map((c) => ({
            date: c.date.toISOString().split('T')[0],
            close: c.close,
            volume: c.volume,
            high: c.high,
            low: c.low,
          })),
          sector: sectorEtf
            ? {
                etf: sectorEtf,
                candles: sectorCandles.map((c) => ({
                  date: c.date.toISOString().split('T')[0],
                  close: c.close,
                  volume: c.volume,
                  high: c.high,
                  low: c.low,
                })),
              }
            : null,
        });
      } catch (error) {
        req.log.error({ err: error }, 'backtest-data failed');
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

        const closes = data.map((d) => d.close);
        const sma20 = calcSMA(closes, 20);
        const sma50 = calcSMA(closes, 50);
        const sma200 = calcSMA(closes, 200);
        const bb = calcBB(closes, 20, 2);
        // Gaussian Channel — full per-bar series (mid/upper/lower + trend color)
        const gc = gaussianChannel(closes).series;

        const fromDate = data[0]?.date.toISOString().split('T')[0] ?? '';
        const signalMap = new Map(
          getSignalHistory(ticker, fromDate).map((s) => [s.date, s.opinion])
        );

        return reply.send(
          data.map((d, i) => {
            const date = d.date.toISOString().split('T')[0];
            return {
              time: date,
              open: d.open ?? d.close,
              high: d.high ?? d.close,
              low: d.low ?? d.close,
              close: d.close,
              volume: d.volume ?? 0,
              sma20: sma20[i],
              sma50: sma50[i],
              sma200: sma200[i],
              bbUpper: bb[i].upper,
              bbLower: bb[i].lower,
              gaussianMid: gc[i].mid,
              gaussianUpper: gc[i].upper,
              gaussianLower: gc[i].lower,
              gaussianGreen: gc[i].isGreen,
              signal: signalMap.get(date) ?? null,
            };
          })
        );
      } catch (error) {
        req.log.error({ err: error }, 'ohlcv failed');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
};
