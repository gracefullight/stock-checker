import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { screenerRoutes } from '@/routes/screener';

vi.mock('@stock-checker/core/src/portfolio/manager', () => ({
  getPortfolio: vi.fn(),
}));

vi.mock('@stock-checker/core/src/services/data-fetcher', () => ({
  getFearGreedIndex: vi.fn(),
  getHistoricalPrices: vi.fn(),
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

vi.mock('@stock-checker/core/src/utils/signal-history', () => ({
  getSignalHistory: vi.fn(),
}));

vi.mock('@/lib/analyze', () => ({
  analyzeTicker: vi.fn(),
}));

import { getPortfolio } from '@stock-checker/core/src/portfolio/manager';
import { getFearGreedIndex } from '@stock-checker/core/src/services/data-fetcher';
import { analyzeTicker } from '@/lib/analyze';

const mockedGetPortfolio = vi.mocked(getPortfolio);
const mockedGetFearGreedIndex = vi.mocked(getFearGreedIndex);
const mockedAnalyzeTicker = vi.mocked(analyzeTicker);

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
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/screener', () => {
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
      expect(mockedAnalyzeTicker).toHaveBeenCalledWith('AAPL', 50);
    });

    it('uppercases ticker from query param', async () => {
      mockedGetFearGreedIndex.mockResolvedValue(30);
      mockedAnalyzeTicker.mockResolvedValue(mockTickerResult as never);

      await app.inject({ method: 'GET', url: '/api/screener?tickers=aapl' });

      expect(mockedAnalyzeTicker).toHaveBeenCalledWith('AAPL', 30);
    });

    it('falls back to portfolio when no tickers query param', async () => {
      mockedGetPortfolio.mockResolvedValue({ assets: ['MSFT'], createdAt: 'x' } as never);
      mockedGetFearGreedIndex.mockResolvedValue(60);
      mockedAnalyzeTicker.mockResolvedValue({ ...mockTickerResult, ticker: 'MSFT' } as never);

      const res = await app.inject({ method: 'GET', url: '/api/screener' });

      expect(res.statusCode).toBe(200);
      expect(mockedGetPortfolio).toHaveBeenCalled();
      expect(mockedAnalyzeTicker).toHaveBeenCalledWith('MSFT', 60);
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
    it('returns 200 with ticker result', async () => {
      mockedGetFearGreedIndex.mockResolvedValue(50);
      mockedAnalyzeTicker.mockResolvedValue(mockTickerResult as never);

      const res = await app.inject({ method: 'GET', url: '/api/screener/aapl' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ticker: 'AAPL' });
      expect(mockedAnalyzeTicker).toHaveBeenCalledWith('AAPL', 50);
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
});
