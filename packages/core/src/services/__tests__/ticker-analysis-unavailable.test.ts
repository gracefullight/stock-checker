import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import { fetchBenchmarkPrices, getHistoricalPrices } from '@/services/data-fetcher';
import { getEarningsData } from '@/services/earnings';
import { getFundamentals } from '@/services/fundamentals';
import { calculateAllIndicators } from '@/services/indicators';
import {
  analyzeTicker,
  analyzeTickerContext,
  type TickerAnalysisUnavailable,
} from '@/services/ticker-analysis';
import type { IndicatorValues } from '@/types';

vi.mock('@/services/data-fetcher', () => ({
  getHistoricalPrices: vi.fn(),
  fetchBenchmarkPrices: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/services/fundamentals', () => ({ getFundamentals: vi.fn().mockResolvedValue(null) }));
vi.mock('@/services/earnings', () => ({ getEarningsData: vi.fn().mockResolvedValue(null) }));
vi.mock('@/services/indicators', () => ({
  calculateAllIndicators: vi.fn(),
  calcRecentMacdHistogram: vi.fn().mockReturnValue([0]),
}));

const bar: Awaited<ReturnType<typeof getHistoricalPrices>>[number] = {
  date: new Date('2026-10-05T00:00:00.000Z'),
  open: 100,
  high: 101,
  low: 99,
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHistoricalPrices).mockResolvedValue([bar]);
  vi.mocked(calculateAllIndicators).mockReturnValue(indicators);
});

describe('analysis availability diagnostics', () => {
  it('distinguishes an empty price history from a rejected risk reference', async () => {
    vi.mocked(getHistoricalPrices).mockResolvedValue([]);
    const onUnavailable = vi.fn();

    expect(await analyzeTickerContext('MISSING', null, { onUnavailable })).toBeNull();
    expect(onUnavailable).toHaveBeenCalledExactlyOnceWith({ code: 'history-unavailable', rows: 0 });
    expect(calculateAllIndicators).not.toHaveBeenCalled();
  });

  it.each([
    { ticker: 'NIVF', rows: 500, close: 0.11, atr: 0.17364761106778515 },
    { ticker: 'JAGX', rows: 500, close: 4.73, atr: 3.979291241012127 },
    { ticker: 'LESL', rows: 500, close: 0.102, atr: 0.10455108651397087 },
    { ticker: 'RETO', rows: 500, close: 1.95, atr: 15.664598923641226 },
    { ticker: 'ADBT', rows: 29, close: 0.13, atr: 0.22449816102252196 },
    { ticker: 'AXG', rows: 500, close: 0.105, atr: 0.1742639063156625 },
  ])('reports $ticker as risk-infeasible while preserving its null analysis', async (fixture) => {
    // Public close/ATR observations from the completed 2026-10-05 session.
    vi.mocked(getHistoricalPrices).mockResolvedValue(
      Array.from({ length: fixture.rows }, () => ({ ...bar, close: fixture.close }))
    );
    vi.mocked(calculateAllIndicators).mockReturnValue({ ...indicators, atr: fixture.atr });
    const onUnavailable = vi.fn();

    expect(await analyzeTicker(fixture.ticker, null, { onUnavailable })).toBeNull();
    expect(onUnavailable).toHaveBeenCalledExactlyOnceWith({
      code: 'risk-levels-infeasible',
      rows: fixture.rows,
      close: fixture.close,
      atr: fixture.atr,
    });
    expect(fetchBenchmarkPrices).not.toHaveBeenCalled();
    expect(getFundamentals).not.toHaveBeenCalled();
    expect(getEarningsData).not.toHaveBeenCalled();
  });

  it.each([
    { close: 0, atr: 2 },
    { close: -1, atr: 2 },
    { close: Number.NaN, atr: 2 },
    { close: Number.POSITIVE_INFINITY, atr: 2 },
    { close: 100, atr: 0 },
    { close: 100, atr: Number.NaN },
    { close: 100, atr: Number.POSITIVE_INFINITY },
  ])('reports invalid inputs without exposing nonfinite values: $close / $atr', async (fixture) => {
    vi.mocked(getHistoricalPrices).mockResolvedValue([{ ...bar, close: fixture.close }]);
    vi.mocked(calculateAllIndicators).mockReturnValue({ ...indicators, atr: fixture.atr });
    const onUnavailable = vi.fn();

    expect(await analyzeTickerContext('INVALID', null, { onUnavailable })).toBeNull();
    expect(onUnavailable).toHaveBeenCalledExactlyOnceWith({
      code: 'invalid-price-or-atr',
      rows: 1,
      ...(Number.isFinite(fixture.close) ? { close: fixture.close } : {}),
      ...(Number.isFinite(fixture.atr) ? { atr: fixture.atr } : {}),
    });
  });

  it.each([
    { code: 'history-unavailable', prices: [], atr: 2 },
    { code: 'invalid-price-or-atr', prices: [bar], atr: 0 },
    { code: 'risk-levels-infeasible', prices: [{ ...bar, close: 1 }], atr: 2 },
  ])('preserves null when the $code callback throws', async ({ code, prices, atr }) => {
    vi.mocked(getHistoricalPrices).mockResolvedValue(prices);
    vi.mocked(calculateAllIndicators).mockReturnValue({ ...indicators, atr });
    const onUnavailable = vi.fn(() => {
      throw new Error('Diagnostic consumer failed');
    });

    await expect(analyzeTicker('UNAVAILABLE', null, { onUnavailable })).resolves.toBeNull();
    expect(onUnavailable).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code }));
  });

  it.each([false, true])(
    'reports native latest-bar ATR rejection after replay, callback throws=%s',
    async (callbackThrows) => {
      const prices = Array.from({ length: 210 }, (_, index) => ({
        ...bar,
        date: new Date(Date.UTC(2026, 0, index + 1)),
        ...(index === 209 ? { open: 0.1, close: 0.1, high: 0.11, low: 0.09 } : {}),
      }));
      vi.mocked(getHistoricalPrices).mockResolvedValue(prices);
      vi.mocked(calculateAllIndicators).mockReturnValue({ ...indicators, atr: 0.01 });
      const onUnavailable = vi.fn<(reason: TickerAnalysisUnavailable) => void>(() => {
        if (callbackThrows) throw new Error('Diagnostic consumer failed');
      });

      expect(
        await analyzeTickerContext('REPLAY', null, {
          pipelineConfig: structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG),
          onUnavailable,
        })
      ).toBeNull();
      expect(onUnavailable).toHaveBeenCalledExactlyOnceWith({
        code: 'risk-levels-infeasible',
        rows: 210,
        close: 0.1,
        atr: expect.any(Number),
      });
      expect(onUnavailable.mock.calls[0][0].atr).toBeGreaterThan(0.1);
    }
  );

  it('keeps the callback optional and does not label a usable analysis unavailable', async () => {
    const pipelineConfig = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    const onUnavailable = vi.fn();

    expect(await analyzeTicker('VALID', null, { pipelineConfig, onUnavailable })).not.toBeNull();
    expect(onUnavailable).not.toHaveBeenCalled();
    vi.mocked(getHistoricalPrices).mockResolvedValue([]);
    expect(await analyzeTicker('MISSING', null)).toBeNull();
  });
});
