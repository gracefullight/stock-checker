import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@stock-checker/core/src/services/data-fetcher', () => ({
  getHistoricalPrices: vi.fn(),
  fetchBenchmarkPrices: vi.fn(),
}));
vi.mock('@stock-checker/core/src/services/earnings', () => ({ getEarningsData: vi.fn() }));
vi.mock('@stock-checker/core/src/services/fundamentals', () => ({ getFundamentals: vi.fn() }));
vi.mock('@stock-checker/core/src/services/indicators', () => ({
  calculateAllIndicators: vi.fn(),
  calcRecentMacdHistogram: vi.fn(() => []),
}));
vi.mock('@stock-checker/core/src/services/patterns', () => ({
  detectPatterns: vi.fn(() => ({ score: 0, patterns: [] })),
}));
vi.mock('@stock-checker/core/src/services/pipeline', () => ({ evaluateSignal: vi.fn() }));
vi.mock('@stock-checker/core/src/services/probability', () => ({
  calculateProbabilities: vi.fn(() => ({
    buyProbability: 20,
    sellProbability: 60,
    holdProbability: 20,
    confidence: 'high',
  })),
}));
vi.mock('@stock-checker/core/src/services/risk-levels', () => ({
  calculateLongRiskLevels: vi.fn(),
}));

import {
  fetchBenchmarkPrices,
  getHistoricalPrices,
} from '@stock-checker/core/src/services/data-fetcher';
import { getEarningsData } from '@stock-checker/core/src/services/earnings';
import { getFundamentals } from '@stock-checker/core/src/services/fundamentals';
import { calculateAllIndicators } from '@stock-checker/core/src/services/indicators';
import { evaluateSignal } from '@stock-checker/core/src/services/pipeline';
import { calculateLongRiskLevels } from '@stock-checker/core/src/services/risk-levels';
import { analyzeTicker } from '@/lib/analyze';

const date = new Date('2026-10-01T00:00:00Z');
const candles = [
  { date, open: 100, high: 101, low: 99, close: 100, adjClose: 100, volume: 1_000_000 },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getHistoricalPrices).mockResolvedValue(candles);
  vi.mocked(fetchBenchmarkPrices).mockResolvedValue([]);
  vi.mocked(getFundamentals).mockResolvedValue(null as never);
  vi.mocked(getEarningsData).mockResolvedValue({
    earningsHistory: [
      { epsActual: 1, epsEstimate: 1 },
      { epsActual: 3, epsEstimate: 2 },
    ],
    estimateRevisions: { direction: 'down' },
  } as never);
  vi.mocked(calculateAllIndicators).mockReturnValue({ atr: 2 } as never);
  vi.mocked(calculateLongRiskLevels).mockReturnValue({
    stopLoss: 97,
    takeProfit: 106,
    trailingStop: 97,
    trailingStart: 101,
  });
  vi.mocked(evaluateSignal).mockReturnValue({
    finalDecision: 'SELL',
    score: 100,
    buyScore: 0,
    sellScore: 100,
    gateResults: {
      trend: { regime: 'down' },
      confluence: { ratio: 0.5 },
      institutional: { score: 100 },
    },
  } as never);
});

describe('financial analysis inputs', () => {
  it('keeps Bitcoin sentiment for display without feeding it to an equity signal', async () => {
    const result = await analyzeTicker('AAPL', 95);

    expect(evaluateSignal).toHaveBeenCalledWith(
      expect.objectContaining({ fearGreed: null, allDates: [date] })
    );
    expect(result?.fearGreed).toBe(95);
  });

  it('uses same-period estimate revisions instead of increasing quarterly EPS', async () => {
    await analyzeTicker('AAPL', null);

    expect(evaluateSignal).toHaveBeenCalledWith(
      expect.objectContaining({ earningsEstimateUp: false, earningsBeat: true })
    );
  });

  it.each(['flat', null])('does not invent a revision direction for %s data', async (direction) => {
    vi.mocked(getEarningsData).mockResolvedValue({
      earningsHistory: [],
      estimateRevisions: { direction },
    } as never);

    await analyzeTicker('AAPL', null);

    expect(evaluateSignal).toHaveBeenCalledWith(
      expect.objectContaining({ earningsEstimateUp: null })
    );
  });

  it('returns long-holder risk levels for an exit-only SELL signal', async () => {
    const result = await analyzeTicker('AAPL', null);

    expect(result?.opinion).toBe('SELL');
    expect(result?.stopLoss).toBe(97);
    expect(result?.takeProfit).toBe(106);
  });

  it('does not publish an analysis with unusable risk levels', async () => {
    vi.mocked(calculateLongRiskLevels).mockReturnValue(null);

    expect(await analyzeTicker('AAPL', null)).toBeNull();
    expect(evaluateSignal).not.toHaveBeenCalled();
  });

  it('does not duplicate market-relative strength when an unknown ticker has no sector', async () => {
    await analyzeTicker('UNMAPPED', null);

    expect(fetchBenchmarkPrices).toHaveBeenCalledTimes(1);
    expect(fetchBenchmarkPrices).toHaveBeenCalledWith('SPY');
    expect(evaluateSignal).toHaveBeenCalledWith(expect.objectContaining({ sectorCandles: [] }));
  });

  it('uses nominal dollar volume when corporate-action-adjusted candles provide it', async () => {
    vi.mocked(getHistoricalPrices).mockResolvedValue([
      { ...candles[0], dollarVolume: 200_000_000 },
    ]);

    await analyzeTicker('AAPL', null);

    expect(evaluateSignal).toHaveBeenCalledWith(
      expect.objectContaining({ avgDailyDollarVol: 200_000_000 })
    );
  });
});
