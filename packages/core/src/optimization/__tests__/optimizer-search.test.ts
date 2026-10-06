import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import { optimizeWithData } from '@/optimization/optimizer-core';

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/optimization/backtester', () => ({
  Backtester: class {
    run = mocks.run;
  },
}));

const bars = Array.from({ length: 210 }, (_, i) => ({
  date: new Date(Date.UTC(2024, 0, i + 1)),
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1_000_000,
}));
const metrics = {
  totalTrades: 2,
  sharpeRatio: -0.1,
  maxDrawdown: 10,
  winRate: 0,
  profitFactor: 0,
  return: -0.02,
};

describe('optimizer candidate selection', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('evaluates the full active baseline first and refuses a zero-trade challenger', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const config = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    config.thresholds = { buy: 185, sell: 145 };
    mocks.run
      .mockReturnValueOnce(metrics)
      .mockReturnValueOnce({ ...metrics, totalTrades: 0, sharpeRatio: 0, maxDrawdown: 0 });

    const result = optimizeWithData(bars, 2, undefined, undefined, config);
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(mocks.run.mock.calls[0][0]).toEqual(config);
    expect(mocks.run.mock.calls[1][0].thresholds).not.toEqual(config.thresholds);
    expect(result.bestParams).toEqual(config);
    expect(result.bestParams).not.toBe(config);
    expect(result.metrics.totalTrades).toBe(2);
  });
});
