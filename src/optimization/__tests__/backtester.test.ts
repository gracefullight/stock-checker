import { describe, expect, it } from 'vitest';
import { Backtester } from '@/optimization/backtester';
import type { OptimizationParams } from '@/optimization/types';

interface Candle {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
}

function generateCandles(count: number, startPrice = 100): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const baseDate = new Date('2024-01-01');
  for (let i = 0; i < count; i++) {
    const change = (Math.sin(i / 10) * 2) + 0.1;
    price += change;
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() + i);
    candles.push({
      date, open: price - 0.5, high: price + 2, low: price - 2, close: price, volume: 1000000,
    });
  }
  return candles;
}

const defaultParams: OptimizationParams = {
  indicatorWeights: {
    rsi: 1,
    stochastic: 1,
    bollinger: 1,
    donchian: 1,
    williamsR: 1,
    fearGreed: 1,
    macd: 1,
    sma: 1,
    ema: 1,
  },
  patternWeights: {
    ascendingTriangle: 1,
    bullishFlag: 1,
    doubleBottom: 1,
    fallingWedge: 1,
    islandReversal: 1,
  },
  thresholds: {
    buy: 2,
    sell: 2,
  },
  calibration: {
    slope: 1,
    intercept: 0,
  },
};

describe('Backtester', () => {
  const candles = generateCandles(150);
  const backtester = new Backtester(candles);

  it('should run without errors on synthetic uptrend data', () => {
    const metrics = backtester.run(defaultParams);
    expect(metrics).toBeDefined();
  });

  it('should return all required metric fields', () => {
    const metrics = backtester.run(defaultParams);
    expect(metrics).toHaveProperty('sharpeRatio');
    expect(metrics).toHaveProperty('maxDrawdown');
    expect(metrics).toHaveProperty('winRate');
    expect(metrics).toHaveProperty('totalTrades');
    expect(metrics).toHaveProperty('profitFactor');
    expect(metrics).toHaveProperty('return');
  });

  it('should have maxDrawdown between 0 and 100', () => {
    const metrics = backtester.run(defaultParams);
    expect(metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(metrics.maxDrawdown).toBeLessThanOrEqual(100);
  });

  it('should have winRate between 0 and 100', () => {
    const metrics = backtester.run(defaultParams);
    expect(metrics.winRate).toBeGreaterThanOrEqual(0);
    expect(metrics.winRate).toBeLessThanOrEqual(100);
  });

  it('should produce no trades with extremely high thresholds', () => {
    const highThresholdParams: OptimizationParams = {
      ...defaultParams,
      thresholds: { buy: 9999, sell: 9999 },
    };
    const metrics = backtester.run(highThresholdParams);
    expect(metrics.totalTrades).toBe(0);
  });

  it('should have profitFactor >= 0', () => {
    const metrics = backtester.run(defaultParams);
    expect(metrics.profitFactor).toBeGreaterThanOrEqual(0);
  });
});
