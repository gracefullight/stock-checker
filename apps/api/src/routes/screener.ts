import { SECTOR_ETF_MAP } from '@stock-checker/core/src/constants';
import { TICKER_SECTOR_ETF } from '@stock-checker/core/src/constants/tickers';
import { getPortfolio } from '@stock-checker/core/src/portfolio/manager';
import { gaussianChannel } from '@stock-checker/core/src/services/gaussian-channel';
import { calcBB, calcSMA } from '@stock-checker/core/src/utils/chart-indicators';
import { loadPipelineConfig } from '@stock-checker/core/src/utils/config-loader';
import { getSignalHistory } from '@stock-checker/core/src/utils/signal-history';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { cachedAnalyzeTicker } from '@/lib/cached/analyze';
import { cachedFearGreed } from '@/lib/cached/market';
import {
  cachedBacktestPrices,
  cachedBenchmarkPrices,
  cachedHistoricalPrices,
  cachedQuoteSnapshots,
} from '@/lib/cached/prices';
import {
  cachedDividends,
  cachedEarnings,
  cachedFundamentals,
  cachedNews,
} from '@/lib/cached/reference';
import { mapSettledWithConcurrency } from '@/lib/concurrency';
import { safeErrorText } from '@/lib/error-text';

interface ScreenerQuery {
  tickers?: string;
}

interface SingleTickerQuery {
  include?: string;
}

interface SingleTickerParams {
  ticker: string;
}

interface DaysQuery {
  days?: number;
}

/** Upper bound on one screener request; the web universe is 20 symbols. */
export const MAX_SCREENER_TICKERS = 50;
/** Concurrent per-ticker analyses; each one fans out to several Yahoo calls. */
export const SCREENER_CONCURRENCY = 4;
const TICKER_PATTERN = /^\^?[A-Z0-9]+(?:[.-][A-Z0-9]+)*(?:=[A-Z0-9]+)?$/;

const daysQuerystringSchema = {
  type: 'object',
  properties: { days: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } },
};

async function validateDays(
  req: FastifyRequest<{ Params: SingleTickerParams; Querystring: DaysQuery }>,
  reply: FastifyReply
) {
  // Query coercion can admit Infinity even with an integer schema.
  if (req.query.days !== undefined && !Number.isSafeInteger(req.query.days)) {
    return reply.status(400).send({ error: 'days must be a positive safe integer' });
  }
}

export const screenerRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ScreenerQuery }>(
    '/screener',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { tickers: { type: 'string' } },
        },
      },
    },
    async (req, reply) => {
      try {
        let tickers: string[];

        if (req.query.tickers) {
          tickers = [
            ...new Set(
              req.query.tickers
                .split(',')
                .map((t) => t.trim().toUpperCase())
                .filter(Boolean)
            ),
          ];
          const invalid = tickers.filter((ticker) => !TICKER_PATTERN.test(ticker));
          if (invalid.length > 0) {
            return reply.status(400).send({
              error: `Invalid ticker symbol${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}. Use symbols such as AAPL, BRK-B or 005930.KS.`,
            });
          }
          if (tickers.length > MAX_SCREENER_TICKERS) {
            return reply.status(400).send({
              error: `Too many tickers: ${tickers.length} requested, at most ${MAX_SCREENER_TICKERS} per request. Split the list or use a saved market screen.`,
            });
          }
        } else {
          const portfolio = await getPortfolio();
          tickers = portfolio.assets.slice(0, MAX_SCREENER_TICKERS);
        }

        if (tickers.length === 0) {
          return reply.send({
            results: [],
            unavailable: [],
            fearGreed: null,
            generatedAt: new Date().toISOString(),
          });
        }

        const fearGreed = await cachedFearGreed();
        // Throttled analysis (slow, per-ticker) and the quote snapshot lookup (one batch call) run together.
        const [settled, snapshots] = await Promise.all([
          mapSettledWithConcurrency(tickers, SCREENER_CONCURRENCY, (ticker) =>
            cachedAnalyzeTicker(ticker, fearGreed)
          ),
          cachedQuoteSnapshots(tickers),
        ]);

        const snapshotMap = snapshots ?? {};
        const results: Array<NonNullable<Awaited<ReturnType<typeof cachedAnalyzeTicker>>>> = [];
        const unavailable: Array<{ ticker: string; reason: string }> = [];
        settled.forEach((outcome, index) => {
          const ticker = tickers[index];
          if (outcome.status === 'rejected') {
            req.log.warn({ ticker }, 'screener ticker analysis failed');
            unavailable.push({
              ticker,
              reason: safeErrorText(outcome.reason, 'Analysis request failed.'),
            });
            return;
          }
          const r = outcome.value;
          if (!r) {
            unavailable.push({ ticker, reason: 'No usable completed-session analysis.' });
            return;
          }
          const snap = snapshotMap[r.ticker];
          results.push({
            ...r,
            name: snap?.name ?? r.name,
            marketCap: snap?.marketCap ?? null,
            dayChangePct: snap?.dayChangePct ?? null,
          });
        });

        return reply.send({
          results,
          unavailable,
          fearGreed,
          generatedAt: new Date().toISOString(),
        });
      } catch (error) {
        req.log.error({ err: error }, 'screener failed');
        return reply
          .status(500)
          .send({ error: 'Internal server error', detail: safeErrorText(error) });
      }
    }
  );

  app.get<{ Params: SingleTickerParams; Querystring: SingleTickerQuery }>(
    '/screener/:ticker',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { include: { type: 'string' } },
        },
      },
    },
    async (req, reply) => {
      try {
        const ticker = req.params.ticker.toUpperCase();
        const includeFields = req.query.include
          ? req.query.include.split(',').map((s) => s.trim())
          : [];

        const fearGreed = await cachedFearGreed();
        const result = await cachedAnalyzeTicker(ticker, fearGreed);

        if (!result) {
          return reply.status(404).send({ error: `No data found for ticker: ${ticker}` });
        }

        const extras: Record<string, unknown> = {};

        await Promise.all([
          Promise.resolve(cachedQuoteSnapshots([ticker])).then((snaps) => {
            const snap = snaps?.[ticker];
            if (snap) {
              extras.name = snap.name;
              extras.marketCap = snap.marketCap;
              extras.dayChangePct = snap.dayChangePct;
            }
          }),
          includeFields.includes('fundamentals')
            ? cachedFundamentals(ticker).then((d) => {
                extras.fundamentals = d;
              })
            : Promise.resolve(),
          includeFields.includes('news')
            ? cachedNews(ticker, 5).then((d) => {
                extras.news = d;
              })
            : Promise.resolve(),
          includeFields.includes('earnings')
            ? cachedEarnings(ticker).then((d) => {
                extras.earnings = d;
              })
            : Promise.resolve(),
          includeFields.includes('dividends')
            ? cachedDividends(ticker).then((d) => {
                extras.dividends = d;
              })
            : Promise.resolve(),
        ]);

        return reply.send({ ...result, ...extras });
      } catch (error) {
        req.log.error({ err: error }, 'single screener failed');
        return reply
          .status(500)
          .send({ error: 'Internal server error', detail: safeErrorText(error) });
      }
    }
  );

  // GET /api/screener/:ticker/backtest-data?days=1825
  // Raw candles + benchmark series for the browser backtest playground.
  app.get<{ Params: SingleTickerParams; Querystring: DaysQuery }>(
    '/screener/:ticker/backtest-data',
    { schema: { querystring: daysQuerystringSchema }, preHandler: validateDays },
    async (req, reply) => {
      try {
        const ticker = req.params.ticker.toUpperCase();
        const days = Math.min(req.query.days ?? 1825, 1825);

        const toCandles = (
          data: Awaited<ReturnType<typeof cachedBacktestPrices>>
        ): Array<{
          date: string;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
          dollarVolume?: number;
        }> =>
          data.map((d) => ({
            date: d.date.toISOString().split('T')[0],
            open: d.open ?? d.close,
            high: d.high ?? d.close,
            low: d.low ?? d.close,
            close: d.close,
            volume: d.volume ?? 0,
            dollarVolume: d.dollarVolume,
          }));

        const [data, spy, fund, pipelineConfig] = await Promise.all([
          cachedBacktestPrices(ticker, days),
          cachedBenchmarkPrices('SPY', days),
          cachedFundamentals(ticker).catch(() => null),
          loadPipelineConfig(),
        ]);

        if (data.length === 0) {
          return reply.status(404).send({ error: `No data found for ticker: ${ticker}` });
        }

        const sectorEtf =
          (fund?.sector ? SECTOR_ETF_MAP[fund.sector] : undefined) ??
          TICKER_SECTOR_ETF[ticker] ??
          null;
        const sectorCandles = sectorEtf ? await cachedBenchmarkPrices(sectorEtf, days) : [];

        return reply.send({
          ticker,
          pipelineConfig,
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
  app.get<{ Params: SingleTickerParams; Querystring: DaysQuery }>(
    '/screener/:ticker/ohlcv',
    { schema: { querystring: daysQuerystringSchema }, preHandler: validateDays },
    async (req, reply) => {
      try {
        const ticker = req.params.ticker.toUpperCase();
        const days = Math.min(req.query.days ?? 180, 730);
        const data = await cachedHistoricalPrices(ticker, days);

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
