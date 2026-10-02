import { beforeEach, describe, expect, it, vi } from 'vitest';
import { predict } from '@/commands/predict';
import { DEFAULT_PIPELINE_CONFIG } from '@/constants';
import { fetchBenchmarkPrices, getHistoricalPrices } from '@/services/data-fetcher';
import { type EarningsData, getEarningsData } from '@/services/earnings';
import { calculateAllIndicators } from '@/services/indicators';
import { evaluateSignal } from '@/services/pipeline';
import type { IndicatorValues, PipelineResult } from '@/types';
import { loadOptimizedConfig } from '@/utils/config-loader';
import { writeToCsv } from '@/utils/csv-writer';

vi.mock('@/services/data-fetcher', () => ({
  getHistoricalPrices: vi.fn(),
  getFearGreedIndex: vi.fn().mockResolvedValue(10),
  fetchBenchmarkPrices: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/services/fundamentals', () => ({ getFundamentals: vi.fn().mockResolvedValue(null) }));
vi.mock('@/services/earnings', () => ({ getEarningsData: vi.fn(), formatEarningsData: vi.fn() }));
vi.mock('@/services/indicators', () => ({
  calculateAllIndicators: vi.fn(),
  calcRecentMacdHistogram: vi.fn().mockReturnValue([0]),
}));
vi.mock('@/services/patterns', () => ({
  detectPatterns: vi.fn().mockReturnValue({ score: 0, patterns: [] }),
}));
vi.mock('@/services/pipeline', () => ({ evaluateSignal: vi.fn() }));
vi.mock('@/utils/config-loader', () => ({ loadOptimizedConfig: vi.fn() }));
vi.mock('@/utils/csv-writer', () => ({ writeToCsv: vi.fn() }));
vi.mock('@/ui/summary', () => ({ printSummaryTable: vi.fn() }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const bar: Awaited<ReturnType<typeof getHistoricalPrices>>[number] = {
  date: new Date('2026-10-01T00:00:00.000Z'),
  open: 101,
  high: 102,
  low: 98,
  close: 100,
  adjClose: 100,
  volume: 1_000_000,
};
const indicators: IndicatorValues = {
  rsi: 45,
  stochasticK: 40,
  bbLower: 90,
  bbUpper: 110,
  donchLower: 90,
  donchUpper: 110,
  williamsR: -60,
  atr: 2,
  macd: 0,
  macdSignal: 0,
  macdHistogram: 0,
  sma20: 100,
  ema20: 100,
  sma50: 105,
  sma200: 110,
  volumeRatio: 1,
};
const pipelineResult: PipelineResult = {
  ticker: 'TEST',
  finalDecision: 'SELL',
  score: 200,
  buyScore: 0,
  sellScore: 200,
  confidence: 0,
  gateResults: {
    trend: { passed: false, regime: 'downtrend', strength: 0, reason: 'test' },
    confluence: { passed: false, activeIndicators: 0, totalIndicators: 6, ratio: 0 },
    reversal: { status: 'rejected', trigger: null },
    institutional: {
      score: 0,
      passed: false,
      components: { rsSpy: 0, rsSector: 0, vwap: 0, breakoutVol: 0, liquidity: 0, earnings: 0 },
    },
  },
};
const earnings: EarningsData = {
  ticker: 'TEST',
  nextEarningsDate: null,
  nextEarningsEstimate: null,
  earningsHistory: [
    {
      reportDate: new Date('2026-01-01'),
      epsActual: 1.2,
      epsEstimate: 1,
      epsDifference: 0.2,
      surprisePercent: 20,
    },
    {
      reportDate: new Date('2026-04-01'),
      epsActual: 2.2,
      epsEstimate: 2,
      epsDifference: 0.2,
      surprisePercent: 10,
    },
  ],
  earningsTrend: [],
  estimateRevisions: {
    current: 1.8,
    thirtyDaysAgo: 2,
    up30: 0,
    down30: 2,
    direction: 'down',
  },
  currentQuarterEstimate: null,
  currentYearEstimate: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHistoricalPrices).mockResolvedValue([bar]);
  vi.mocked(fetchBenchmarkPrices).mockResolvedValue([]);
  vi.mocked(calculateAllIndicators).mockReturnValue(indicators);
  vi.mocked(evaluateSignal).mockReturnValue(pipelineResult);
  vi.mocked(getEarningsData).mockResolvedValue(earnings);
  vi.mocked(loadOptimizedConfig).mockResolvedValue({
    weights: DEFAULT_PIPELINE_CONFIG.indicatorWeights,
    thresholds: DEFAULT_PIPELINE_CONFIG.thresholds,
    patternWeights: DEFAULT_PIPELINE_CONFIG.patternWeights,
    calibration: DEFAULT_PIPELINE_CONFIG.calibration,
  });
});

describe('equity prediction finance inputs', () => {
  it('keeps Bitcoin sentiment in the output but excludes it from equity decisions', async () => {
    await predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' });

    expect(evaluateSignal).toHaveBeenCalledWith(
      expect.objectContaining({ fearGreed: null, allDates: [bar.date] })
    );
    expect(writeToCsv).toHaveBeenCalledWith([expect.objectContaining({ fearGreed: 10 })]);
  });

  it('uses long-holder risk references for SELL, preserving its exit-only meaning', async () => {
    await predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' });

    expect(writeToCsv).toHaveBeenCalledWith([
      expect.objectContaining({ opinion: 'SELL', stopLoss: 97, takeProfit: 106 }),
    ]);
  });

  it('uses a downward same-period estimate revision despite rising quarterly EPS estimates', async () => {
    await predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' });

    expect(evaluateSignal).toHaveBeenCalledWith(
      expect.objectContaining({ earningsBeat: true, earningsEstimateUp: false })
    );
  });

  it.each([
    'flat',
    null,
  ] as const)('keeps revision direction %s unknown for scoring', async (direction) => {
    vi.mocked(getEarningsData).mockResolvedValue({
      ...earnings,
      estimateRevisions: earnings.estimateRevisions
        ? { ...earnings.estimateRevisions, direction }
        : null,
    });

    await predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' });

    expect(evaluateSignal).toHaveBeenCalledWith(
      expect.objectContaining({ earningsEstimateUp: null })
    );
  });

  it('skips analysis when ATR does not support valid positive risk levels', async () => {
    vi.mocked(calculateAllIndicators).mockReturnValue({ ...indicators, atr: 0 });
    await predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' });

    expect(evaluateSignal).not.toHaveBeenCalled();
    expect(writeToCsv).toHaveBeenCalledWith([]);
  });

  it('does not reuse SPY as sector evidence when the ticker sector is unknown', async () => {
    await predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' });

    expect(fetchBenchmarkPrices).toHaveBeenCalledExactlyOnceWith('SPY');
    expect(evaluateSignal).toHaveBeenCalledWith(expect.objectContaining({ sectorCandles: [] }));
  });

  it('uses nominal provider dollar turnover for liquidity with adjusted signal prices', async () => {
    vi.mocked(getHistoricalPrices).mockResolvedValue([{ ...bar, dollarVolume: 200_000_000 }]);
    await predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' });

    expect(evaluateSignal).toHaveBeenCalledWith(
      expect.objectContaining({ close: 100, avgDailyDollarVol: 200_000_000 })
    );
  });

  it('uses the static sector mapping when fundamentals are unavailable', async () => {
    await predict({ tickers: ['AAPL'], sort: 'asc', format: 'csv' });

    expect(fetchBenchmarkPrices).toHaveBeenNthCalledWith(1, 'SPY');
    expect(fetchBenchmarkPrices).toHaveBeenNthCalledWith(2, 'XLK');
  });

  it('does not use benchmark candles after the stock as-of date for the market regime', async () => {
    const benchmark = [
      { date: new Date('2026-09-30'), close: 100, high: 101, low: 99, volume: 1_000_000 },
      { date: bar.date, close: 101, high: 102, low: 100, volume: 1_000_000 },
      { date: new Date('2026-10-02'), close: 1, high: 2, low: 1, volume: 1_000_000 },
    ];
    vi.mocked(fetchBenchmarkPrices).mockResolvedValue(benchmark);

    await predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' });

    expect(evaluateSignal).toHaveBeenCalledWith(
      expect.objectContaining({ spyCandles: benchmark.slice(0, 2), marketUptrend: true })
    );
  });
});
