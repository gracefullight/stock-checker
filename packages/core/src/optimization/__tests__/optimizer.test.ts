import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import { Optimizer } from '@/optimization/optimizer';

const mocks = vi.hoisted(() => ({
  loadHistory: vi.fn(),
  loadConfig: vi.fn(),
  optimize: vi.fn(),
}));

vi.mock('pino', () => ({ default: () => ({ info: vi.fn(), debug: vi.fn() }) }));
vi.mock('@/optimization/data-loader', () => ({
  DataLoader: { loadHistoricalData: mocks.loadHistory },
}));
vi.mock('@/optimization/optimizer-core', () => ({ optimizeWithData: mocks.optimize }));
vi.mock('@/utils/config-loader', () => ({ loadPipelineConfig: mocks.loadConfig }));

function candles(symbol: string, count = 250) {
  return Array.from({ length: count }, (_, i) => ({
    symbol,
    date: new Date(Date.UTC(2024, 0, i + 1)),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1_000_000,
  }));
}

describe('runtime optimizer inputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const config = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    config.thresholds = { buy: 190, sell: 140 };
    mocks.loadConfig.mockResolvedValue(config);
    mocks.loadHistory.mockImplementation(async (symbol: string) => candles(symbol));
    mocks.optimize.mockReturnValue({
      bestValue: 0.5,
      bestParams: config,
      nTrials: 2,
      metrics: { totalTrades: 3 },
    });
  });

  it('freezes the active full config and passes ticker, market and sector histories together', async () => {
    const result = await new Optimizer().optimize('AAPL', 2);
    expect(mocks.loadConfig).toHaveBeenCalledOnce();
    expect(mocks.loadHistory.mock.calls.map(([symbol]) => symbol)).toEqual(['AAPL', 'SPY', 'XLK']);
    const [data, trials, _onProgress, benchmarks, baseConfig] = mocks.optimize.mock.calls[0];
    expect(data).toEqual(candles('AAPL'));
    expect(trials).toBe(2);
    expect(benchmarks).toEqual({ spy: candles('SPY'), sector: candles('XLK') });
    expect(baseConfig).toEqual(result.bestParams);
    expect(baseConfig.qualityGate).toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate);
    expect(baseConfig.thresholds).toEqual({ buy: 190, sell: 140 });
  });

  it('does not optimize without the market and sector lookback required by the active config', async () => {
    mocks.loadHistory.mockImplementation(async (symbol: string) =>
      candles(symbol, symbol === 'SPY' ? 126 : 250)
    );
    await expect(new Optimizer().optimize('AAPL', 2)).rejects.toThrow('benchmark history');
    expect(mocks.optimize).not.toHaveBeenCalled();
  });

  it('does not substitute the market benchmark for an unknown sector', async () => {
    await expect(new Optimizer().optimize('UNKNOWN', 2)).rejects.toThrow(
      'Sector benchmark unavailable'
    );
    expect(mocks.loadHistory).not.toHaveBeenCalled();
    expect(mocks.optimize).not.toHaveBeenCalled();
  });
});
