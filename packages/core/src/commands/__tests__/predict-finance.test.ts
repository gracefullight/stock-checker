import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { predict } from '@/commands/predict';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import {
  buildTickerContext,
  evaluateLatestSignalWithContext,
  runSignalsWithContext,
} from '@/optimization/engine';
import { gateReasons } from '@/reports/signal-reasons';
import { fetchBenchmarkPrices, getHistoricalPrices } from '@/services/data-fetcher';
import { type EarningsData, getEarningsData } from '@/services/earnings';
import { calculateAllIndicators } from '@/services/indicators';
import { evaluateSignal } from '@/services/pipeline';
import { analyzeTickerContext } from '@/services/ticker-analysis';
import type { IndicatorValues, PipelineResult } from '@/types';
import { loadPipelineConfig } from '@/utils/config-loader';
import { writeToCsv } from '@/utils/csv-writer';
import { buildStockReportWhatsAppNotification } from '@/utils/stock-report-alerts';
import { isWhatsAppNotificationConfigured, sendWhatsAppNotification } from '@/utils/whatsapp';

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
vi.mock('@/utils/config-loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/config-loader')>()),
  loadPipelineConfig: vi.fn(),
}));
vi.mock('@/utils/csv-writer', () => ({ writeToCsv: vi.fn() }));
vi.mock('@/ui/summary', () => ({ printSummaryTable: vi.fn() }));
vi.mock('@/utils/whatsapp', () => ({
  sendWhatsAppNotification: vi.fn(),
  isWhatsAppNotificationConfigured: vi.fn(),
}));
vi.mock('@/utils/stock-report-alerts', () => ({ buildStockReportWhatsAppNotification: vi.fn() }));
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
  vi.mocked(isWhatsAppNotificationConfigured).mockResolvedValue(true);
  vi.mocked(buildStockReportWhatsAppNotification).mockImplementation(async (input) => ({
    title: input.title,
    asOf: input.asOf,
    summary: input.coverageSummary,
  }));
  vi.mocked(sendWhatsAppNotification).mockResolvedValue({
    status: 'disabled',
    reason: 'not-configured',
  });
  vi.mocked(getHistoricalPrices).mockResolvedValue([bar]);
  vi.mocked(fetchBenchmarkPrices).mockResolvedValue([]);
  vi.mocked(calculateAllIndicators).mockReturnValue(indicators);
  vi.mocked(evaluateSignal).mockReturnValue(pipelineResult);
  vi.mocked(getEarningsData).mockResolvedValue(earnings);
  vi.mocked(loadPipelineConfig).mockResolvedValue(structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG));
});

describe('equity prediction finance inputs', () => {
  it('replays native historical setup state for the completed latest bar in both live interfaces', async () => {
    const { evaluateSignal: realEvaluateSignal } =
      await vi.importActual<typeof import('@/services/pipeline')>('@/services/pipeline');
    vi.mocked(evaluateSignal).mockImplementation(realEvaluateSignal);
    const prices = Array.from({ length: 210 }, (_, index) => {
      const close = 100 + index * 0.5;
      return {
        ...bar,
        date: new Date(Date.UTC(2026, 0, index + 1)),
        open: close + 1,
        close,
        high: close + (index === 209 ? 9 : 1),
        low: close - 1,
      };
    });
    const benchmarks = prices.map((price) => ({ ...price, close: 100, high: 101, low: 99 }));
    vi.mocked(getHistoricalPrices).mockResolvedValue(prices);
    vi.mocked(fetchBenchmarkPrices).mockResolvedValue(benchmarks);
    vi.mocked(getEarningsData).mockResolvedValue({
      ...earnings,
      earningsHistory: [],
      estimateRevisions: null,
    });
    const config = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    const nativeContext = buildTickerContext(prices, benchmarks, benchmarks);
    if (!nativeContext) throw new Error('fixture warmup unavailable');
    const first = evaluateLatestSignalWithContext(
      { ...nativeContext, data: nativeContext.data.slice(0, 206) },
      'AAPL',
      config
    );
    expect(first?.pipelineResult.qualityBlocked).toBe(true);
    const latest = evaluateLatestSignalWithContext(nativeContext, 'AAPL', config);
    expect(latest?.pipelineResult.finalDecision).toBe('HOLD');
    expect(latest?.pipelineResult.qualityBlocked).toBeUndefined();
    const historical = runSignalsWithContext(nativeContext, 'AAPL', config);
    expect(
      historical.some((signal) => signal.date.getTime() === prices.at(-1)!.date.getTime())
    ).toBe(false);

    const shared = await analyzeTickerContext('AAPL', 10, { pipelineConfig: config });
    expect(shared?.pipelineResult).toEqual(latest?.pipelineResult);
    expect(shared?.result.rsi).toBe(latest?.indicators.rsi);
    expect(shared?.result.patterns).toEqual(latest?.patterns);
    vi.clearAllMocks();
    await predict({ tickers: ['AAPL'], sort: 'asc', format: 'csv' });
    expect(writeToCsv).toHaveBeenCalledExactlyOnceWith([shared!.result]);
    expect(sendWhatsAppNotification).not.toHaveBeenCalled();
  });

  it.each([
    { missingSector: false, expected: 'BUY' },
    { missingSector: true, expected: 'HOLD' },
  ] as const)(
    'preserves actual leader-pullback engine decision $expected across CLI and shared analysis',
    async ({ missingSector, expected }) => {
      const { evaluateSignal: realEvaluateSignal } =
        await vi.importActual<typeof import('@/services/pipeline')>('@/services/pipeline');
      vi.mocked(evaluateSignal).mockImplementation(realEvaluateSignal);
      const prices = Array.from({ length: 200 }, (_, index) => {
        const close = 100 + index * 0.5;
        return {
          ...bar,
          date: new Date(Date.UTC(2026, 0, index + 1)),
          open: close + 1,
          close,
          high: close + (index === 199 ? 9 : 1),
          low: close - 1,
        };
      });
      const close = prices.at(-1)!.close;
      vi.mocked(getHistoricalPrices).mockResolvedValue(prices);
      vi.mocked(calculateAllIndicators).mockReturnValue({
        ...indicators,
        rsi: 55,
        stochasticK: 55,
        williamsR: -45,
        sma50: close + 1,
        sma200: 100,
        volumeRatio: 1.1,
        donchUpper: 250,
      });
      vi.mocked(getEarningsData).mockResolvedValue({
        ...earnings,
        earningsHistory: [],
        estimateRevisions: null,
      });
      vi.mocked(fetchBenchmarkPrices).mockImplementation(async (ticker) =>
        ticker === 'XLK' && missingSector
          ? []
          : prices.map((price) => ({ ...price, close: 100, high: 101, low: 99 }))
      );
      const context = await analyzeTickerContext('AAPL', 10);
      expect(context?.pipelineResult.finalDecision).toBe(expected);
      expect(context?.pipelineResult.qualityBlocked).toBe(missingSector ? true : undefined);
      const actualEngineInput = vi.mocked(evaluateSignal).mock.calls[0][0];
      vi.clearAllMocks();

      await predict({ tickers: ['AAPL'], sort: 'asc', format: 'csv' });

      expect(evaluateSignal).toHaveBeenCalledExactlyOnceWith(actualEngineInput);
      expect(writeToCsv).toHaveBeenCalledExactlyOnceWith([context!.result]);
      if (expected === 'BUY') {
        expect(buildStockReportWhatsAppNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            candidates: [expect.objectContaining({ context, gateReasons: gateReasons(context!) })],
          }),
          undefined
        );
      } else {
        expect(sendWhatsAppNotification).not.toHaveBeenCalled();
      }
    }
  );

  it('uses a caller-owned full config snapshot without reloading between cache key and analysis', async () => {
    const frozenConfig = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    frozenConfig.thresholds.buy = 250;
    const context = await analyzeTickerContext('TEST', 10, { pipelineConfig: frozenConfig });
    expect(context?.config).toEqual(frozenConfig);
    expect(context?.config).not.toBe(frozenConfig);
    expect(context?.config.institutional).not.toBe(frozenConfig.institutional);
    expect(loadPipelineConfig).not.toHaveBeenCalled();
    frozenConfig.thresholds.buy = 300;
    expect(context?.config.thresholds.buy).toBe(250);
    expect(evaluateSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ thresholds: { buy: 250, sell: 130 } }),
      })
    );
  });

  it('uses the same full leader-pullback context, decision and reasons as API/MCP analysis', async () => {
    const sharedContext = await analyzeTickerContext('TEST', 10);
    expect(sharedContext).not.toBeNull();
    if (!sharedContext) throw new Error('fixture analysis unavailable');
    const sharedInput = vi.mocked(evaluateSignal).mock.calls[0][0];
    vi.clearAllMocks();

    await predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' });

    expect(evaluateSignal).toHaveBeenCalledExactlyOnceWith(sharedInput);
    expect(sharedInput.config).toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG);
    expect(writeToCsv).toHaveBeenCalledExactlyOnceWith([sharedContext.result]);
    expect(buildStockReportWhatsAppNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [
          expect.objectContaining({
            decision: sharedContext.pipelineResult.finalDecision,
            dataAsOf: sharedContext.result.date,
            reference: {
              price: sharedContext.result.close,
              stopLoss: sharedContext.result.stopLoss,
              takeProfit: sharedContext.result.takeProfit,
              atr: sharedContext.result.atr,
            },
            gateReasons: gateReasons(sharedContext),
            context: sharedContext,
          }),
        ],
      }),
      undefined
    );
  });

  it('freezes one complete strategy snapshot for every ticker in a CLI batch', async () => {
    const config = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    config.thresholds.buy = 250;
    vi.mocked(loadPipelineConfig).mockResolvedValueOnce(config);
    await predict({ tickers: ['TEST', 'OII'], sort: 'asc', format: 'csv' });
    expect(loadPipelineConfig).toHaveBeenCalledOnce();
    expect(evaluateSignal).toHaveBeenCalledTimes(2);
    for (const [input] of vi.mocked(evaluateSignal).mock.calls) {
      expect(input.config).toEqual(config);
      expect(input.config).not.toBe(config);
    }
  });

  it('sends one WhatsApp summary after both CSV and prediction persistence', async () => {
    await predict({ tickers: ['TEST', 'OII'], sort: 'asc', format: 'csv' });

    expect(sendWhatsAppNotification).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        title: '주식 신호',
        asOf: '종가 2026-10-01',
        summary: expect.stringContaining('SELL 2'),
      })
    );
    const notificationOrder = vi.mocked(sendWhatsAppNotification).mock.invocationCallOrder[0];
    expect(vi.mocked(writeToCsv).mock.invocationCallOrder[0]).toBeLessThan(notificationOrder);
    expect(vi.mocked(fs.writeFileSync).mock.invocationCallOrder[0]).toBeLessThan(notificationOrder);
  });

  it('does not alert on HOLD-only runs or runs without a usable analysis', async () => {
    vi.mocked(evaluateSignal).mockReturnValue({ ...pipelineResult, finalDecision: 'HOLD' });
    await predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' });
    expect(sendWhatsAppNotification).not.toHaveBeenCalled();
    expect(buildStockReportWhatsAppNotification).not.toHaveBeenCalled();

    vi.mocked(calculateAllIndicators).mockReturnValue({ ...indicators, atr: 0 });
    await predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' });
    expect(sendWhatsAppNotification).not.toHaveBeenCalled();
  });

  it('enriches from the saved decision and actual optimized pipeline context after persistence', async () => {
    const thresholds = { ...DEFAULT_QUALITY_PIPELINE_CONFIG.thresholds, buy: 332, sell: 198 };
    vi.mocked(loadPipelineConfig).mockResolvedValue({
      ...structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG),
      thresholds,
    });
    await predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' });

    expect(buildStockReportWhatsAppNotification).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        lookbackDays: 730,
        candidates: [
          expect.objectContaining({
            ticker: 'TEST',
            decision: 'SELL',
            dataAsOf: '2026-10-01',
            reference: { price: 100, stopLoss: 97, takeProfit: 106, atr: 2 },
            gateReasons: expect.arrayContaining([
              expect.stringContaining('threshold 332'),
              expect.stringContaining('threshold 198'),
            ]),
            context: expect.objectContaining({
              dailyPrices: [bar],
              pipelineResult,
              config: expect.objectContaining({ thresholds }),
              result: expect.objectContaining({ opinion: 'SELL', date: '2026-10-01' }),
            }),
          }),
        ],
      }),
      undefined
    );
    const enrichmentOrder = vi.mocked(buildStockReportWhatsAppNotification).mock
      .invocationCallOrder[0];
    expect(vi.mocked(fs.writeFileSync).mock.invocationCallOrder[0]).toBeLessThan(enrichmentOrder);
    expect(writeToCsv).toHaveBeenCalledWith([
      expect.not.objectContaining({ context: expect.anything(), gateReasons: expect.anything() }),
    ]);
  });

  it('preserves saved output when report enrichment unexpectedly fails', async () => {
    vi.mocked(buildStockReportWhatsAppNotification).mockRejectedValueOnce(
      new Error('report unavailable')
    );
    await expect(
      predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' })
    ).resolves.toBeUndefined();
    expect(writeToCsv).toHaveBeenCalledOnce();
    expect(fs.writeFileSync).toHaveBeenCalledOnce();
    expect(sendWhatsAppNotification).not.toHaveBeenCalled();
  });

  it('skips report data requests when the local sender is not configured', async () => {
    vi.mocked(isWhatsAppNotificationConfigured).mockResolvedValue(false);
    await predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' });
    expect(buildStockReportWhatsAppNotification).not.toHaveBeenCalled();
    expect(sendWhatsAppNotification).toHaveBeenCalledOnce();
  });

  it('keeps saved results when WhatsApp rejects the request or throws unexpectedly', async () => {
    vi.mocked(sendWhatsAppNotification).mockResolvedValue({
      status: 'failed',
      reason: 'http-error',
      httpStatus: 401,
    });
    await expect(
      predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' })
    ).resolves.toBeUndefined();
    expect(fs.writeFileSync).toHaveBeenCalledOnce();

    vi.mocked(sendWhatsAppNotification).mockRejectedValue(new Error('provider unavailable'));
    await expect(
      predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' })
    ).resolves.toBeUndefined();
    expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
  });

  it('does not send a notification if CSV persistence fails', async () => {
    vi.mocked(writeToCsv).mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(predict({ tickers: ['TEST'], sort: 'asc', format: 'csv' })).rejects.toThrow(
      'disk unavailable'
    );
    expect(sendWhatsAppNotification).not.toHaveBeenCalled();
  });

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

  it.each(['flat', null] as const)(
    'keeps revision direction %s unknown for scoring',
    async (direction) => {
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
    }
  );

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
