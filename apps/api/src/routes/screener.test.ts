import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@stock-checker/core/src/constants';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { screenerRoutes } from '@/routes/screener';

vi.mock('@stock-checker/core/src/portfolio/manager', () => ({
  getPortfolio: vi.fn(),
}));

vi.mock('@stock-checker/core/src/services/data-fetcher', () => ({
  getFearGreedIndex: vi.fn(),
  getHistoricalPrices: vi.fn(),
  fetchBenchmarkPrices: vi.fn(),
  getQuoteSnapshots: vi.fn().mockResolvedValue({}),
}));

vi.mock('@stock-checker/core/src/services/dividends', () => ({
  getDividendInfo: vi.fn(),
}));

vi.mock('@stock-checker/core/src/services/earnings', () => ({
  getEarningsData: vi.fn(),
}));

vi.mock('@stock-checker/core/src/services/fundamentals', () => ({
  getFundamentals: vi.fn(),
}));

vi.mock('@stock-checker/core/src/services/news', () => ({
  getStockNews: vi.fn(),
}));

vi.mock('@stock-checker/core/src/utils/chart-indicators', () => ({
  calcBB: vi.fn(),
  calcSMA: vi.fn(),
}));

vi.mock('@stock-checker/core/src/utils/config-loader', () => ({
  loadPipelineConfig: vi.fn(),
}));

vi.mock('@stock-checker/core/src/utils/signal-history', () => ({
  getSignalHistory: vi.fn(),
}));

vi.mock('@/lib/analyze', () => ({
  analyzeTicker: vi.fn(),
}));

import { getPortfolio } from '@stock-checker/core/src/portfolio/manager';
import {
  fetchBenchmarkPrices,
  getFearGreedIndex,
  getHistoricalPrices,
} from '@stock-checker/core/src/services/data-fetcher';
import { getFundamentals } from '@stock-checker/core/src/services/fundamentals';
import { calcBB, calcSMA } from '@stock-checker/core/src/utils/chart-indicators';
import { loadPipelineConfig } from '@stock-checker/core/src/utils/config-loader';
import { getSignalHistory } from '@stock-checker/core/src/utils/signal-history';
import { analyzeTicker } from '@/lib/analyze';
import { clearCache } from '@/lib/cache';

const mockedGetPortfolio = vi.mocked(getPortfolio);
const mockedGetFearGreedIndex = vi.mocked(getFearGreedIndex);
const mockedAnalyzeTicker = vi.mocked(analyzeTicker);
const mockedGetHistoricalPrices = vi.mocked(getHistoricalPrices);
const mockedFetchBenchmarkPrices = vi.mocked(fetchBenchmarkPrices);
const mockedLoadPipelineConfig = vi.mocked(loadPipelineConfig);

const mockTickerResult = {
  ticker: 'AAPL',
  date: '2026-06-09',
  close: 200,
  volume: 1000000,
  rsi: 55,
  stochasticK: 60,
  bbLower: 190,
  bbUpper: 210,
  donchLower: 185,
  donchUpper: 215,
  williamsR: -40,
  fearGreed: 50,
  patterns: [],
  score: 10,
  opinion: 'BUY',
  atr: 3,
  stopLoss: 195,
  takeProfit: 212,
  trailingStop: 193,
  trailingStart: 207,
  macd: 1.2,
  macdSignal: 0.8,
  macdHistogram: 0.4,
  sma20: 198,
  ema20: 199,
  buyProbability: 0.6,
  sellProbability: 0.2,
  holdProbability: 0.2,
  confidence: 0.7,
  sma50: 195,
  sma200: 180,
  volumeRatio: 1.1,
  trendRegime: 'BULL',
  confluenceRatio: 0.75,
};

async function build() {
  const app = Fastify({ logger: false });
  await app.register(screenerRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

describe('screenerRoutes', () => {
  let app: Awaited<ReturnType<typeof build>>;

  beforeEach(async () => {
    app = await build();
    vi.resetAllMocks();
    mockedLoadPipelineConfig.mockResolvedValue(structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG));
    await clearCache();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/screener', () => {
    it('rejects repeated ticker queries before fetching data', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/screener?tickers=AAPL&tickers=MSFT',
      });

      expect(res.statusCode).toBe(400);
      expect(mockedGetFearGreedIndex).not.toHaveBeenCalled();
      expect(mockedAnalyzeTicker).not.toHaveBeenCalled();
    });

    it('returns 200 with results when tickers query param is provided', async () => {
      mockedGetFearGreedIndex.mockResolvedValue(50);
      mockedAnalyzeTicker.mockResolvedValue(mockTickerResult as never);

      const res = await app.inject({ method: 'GET', url: '/api/screener?tickers=AAPL' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('results');
      expect(body).toHaveProperty('fearGreed', 50);
      expect(body).toHaveProperty('generatedAt');
      expect(body.results).toHaveLength(1);
      expect(body.results[0].ticker).toBe('AAPL');
      expect(mockedAnalyzeTicker).toHaveBeenCalledWith('AAPL', 50, {
        pipelineConfig: DEFAULT_QUALITY_PIPELINE_CONFIG,
      });
    });

    it('uppercases ticker from query param', async () => {
      mockedGetFearGreedIndex.mockResolvedValue(30);
      mockedAnalyzeTicker.mockResolvedValue(mockTickerResult as never);

      await app.inject({ method: 'GET', url: '/api/screener?tickers=aapl' });

      expect(mockedAnalyzeTicker).toHaveBeenCalledWith('AAPL', 30, {
        pipelineConfig: DEFAULT_QUALITY_PIPELINE_CONFIG,
      });
    });

    it('falls back to portfolio when no tickers query param', async () => {
      mockedGetPortfolio.mockResolvedValue({ assets: ['MSFT'], createdAt: 'x' } as never);
      mockedGetFearGreedIndex.mockResolvedValue(60);
      mockedAnalyzeTicker.mockResolvedValue({ ...mockTickerResult, ticker: 'MSFT' } as never);

      const res = await app.inject({ method: 'GET', url: '/api/screener' });

      expect(res.statusCode).toBe(200);
      expect(mockedGetPortfolio).toHaveBeenCalled();
      expect(mockedAnalyzeTicker).toHaveBeenCalledWith('MSFT', 60, {
        pipelineConfig: DEFAULT_QUALITY_PIPELINE_CONFIG,
      });
    });

    it('returns empty results when portfolio is empty and no tickers param', async () => {
      mockedGetPortfolio.mockResolvedValue({ assets: [], createdAt: 'x' } as never);

      const res = await app.inject({ method: 'GET', url: '/api/screener' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toEqual([]);
      expect(body.fearGreed).toBeNull();
    });

    it('filters out null results from failed analyzeTicker calls', async () => {
      mockedGetFearGreedIndex.mockResolvedValue(50);
      mockedAnalyzeTicker
        .mockResolvedValueOnce(mockTickerResult as never)
        .mockRejectedValueOnce(new Error('bad ticker'));

      const res = await app.inject({ method: 'GET', url: '/api/screener?tickers=AAPL,BAD' });

      expect(res.statusCode).toBe(200);
      expect(res.json().results).toHaveLength(1);
    });

    it('returns 500 when getFearGreedIndex rejects', async () => {
      mockedGetFearGreedIndex.mockRejectedValue(new Error('network error'));

      const res = await app.inject({ method: 'GET', url: '/api/screener?tickers=AAPL' });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'Internal server error' });
    });
  });

  describe('GET /api/screener/:ticker', () => {
    it('rejects repeated include queries before analyzing a ticker', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/screener/AAPL?include=news&include=earnings',
      });

      expect(res.statusCode).toBe(400);
      expect(mockedAnalyzeTicker).not.toHaveBeenCalled();
    });

    it('returns 200 with ticker result', async () => {
      mockedGetFearGreedIndex.mockResolvedValue(50);
      mockedAnalyzeTicker.mockResolvedValue(mockTickerResult as never);

      const res = await app.inject({ method: 'GET', url: '/api/screener/aapl' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ticker: 'AAPL' });
      expect(mockedAnalyzeTicker).toHaveBeenCalledWith('AAPL', 50, {
        pipelineConfig: DEFAULT_QUALITY_PIPELINE_CONFIG,
      });
    });

    it('returns 404 when analyzeTicker returns null', async () => {
      mockedGetFearGreedIndex.mockResolvedValue(50);
      mockedAnalyzeTicker.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/api/screener/UNKNOWN' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'No data found for ticker: UNKNOWN' });
    });

    it('returns 500 when analyzeTicker rejects', async () => {
      mockedGetFearGreedIndex.mockResolvedValue(50);
      mockedAnalyzeTicker.mockRejectedValue(new Error('fetch failed'));

      const res = await app.inject({ method: 'GET', url: '/api/screener/AAPL' });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'Internal server error' });
    });
  });

  describe.each([
    { endpoint: 'ohlcv', defaultDays: 180, maxDays: 730, statusCode: 200 },
    { endpoint: 'backtest-data', defaultDays: 1825, maxDays: 1825, statusCode: 404 },
  ])('GET /api/screener/:ticker/$endpoint', ({ endpoint, defaultDays, maxDays, statusCode }) => {
    beforeEach(() => {
      mockedGetHistoricalPrices.mockResolvedValue([]);
      mockedFetchBenchmarkPrices.mockResolvedValue([]);
      vi.mocked(calcSMA).mockReturnValue([]);
      vi.mocked(calcBB).mockReturnValue([]);
      vi.mocked(getSignalHistory).mockReturnValue([]);
    });

    it.each(['abc', '0', '-1', '1.5', 'Infinity', '1e309', '1&days=2'])(
      'rejects invalid days=%s without fetching prices',
      async (days) => {
        const res = await app.inject({
          method: 'GET',
          url: `/api/screener/AAPL/${endpoint}?days=${days}`,
        });

        expect(res.statusCode).toBe(400);
        expect(mockedGetHistoricalPrices).not.toHaveBeenCalled();
        expect(mockedFetchBenchmarkPrices).not.toHaveBeenCalled();
      }
    );

    it.each([
      { query: '', expectedDays: defaultDays },
      { query: '?days=30', expectedDays: 30 },
      { query: '?days=9999', expectedDays: maxDays },
    ])('uses $expectedDays days for query "$query"', async ({ query, expectedDays }) => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/screener/aapl/${endpoint}${query}`,
      });

      expect(res.statusCode).toBe(statusCode);
      expect(mockedGetHistoricalPrices).toHaveBeenCalledWith('AAPL', expectedDays);
    });
  });

  describe('financial backtest data', () => {
    beforeEach(() => {
      mockedGetHistoricalPrices.mockResolvedValue([
        {
          date: new Date('2026-09-30T00:00:00Z'),
          open: 49,
          high: 51,
          low: 48,
          close: 50,
          adjClose: 50,
          volume: 2_000_000,
          dollarVolume: 200_000_000,
        },
      ]);
      mockedFetchBenchmarkPrices.mockResolvedValue([]);
      vi.mocked(getFundamentals).mockResolvedValue(null as never);
    });

    it('returns the complete active strategy snapshot for browser backtests', async () => {
      const active = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
      active.thresholds.buy = 215;
      active.institutional.weights.rsSpy = 0.3;
      active.qualityGate.rsMin = 0.75;
      mockedLoadPipelineConfig.mockResolvedValue(active);

      const res = await app.inject({ method: 'GET', url: '/api/screener/AAPL/backtest-data' });

      expect(res.statusCode).toBe(200);
      expect(res.json().pipelineConfig).toEqual(active);
      expect(mockedLoadPipelineConfig).toHaveBeenCalledTimes(1);
    });

    it('preserves nominal liquidity and the known sector when fundamentals are unavailable', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/screener/AAPL/backtest-data',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().candles[0].dollarVolume).toBe(200_000_000);
      expect(res.json().sector.etf).toBe('XLK');
      expect(mockedFetchBenchmarkPrices).toHaveBeenCalledWith('XLK', 1825);
    });

    it('leaves unknown sector evidence unavailable instead of duplicating SPY', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/screener/UNMAPPED/backtest-data',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().sector).toBeNull();
      expect(mockedFetchBenchmarkPrices).toHaveBeenCalledTimes(1);
    });
  });
});
