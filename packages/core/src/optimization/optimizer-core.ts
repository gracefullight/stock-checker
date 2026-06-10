import { Backtester } from '@/optimization/backtester';
import type { BacktestMetrics } from '@/optimization/types';
import type { BenchmarkCandle, PipelineConfig } from '@/types';

interface Candle {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
}

export interface OptimizeProgress {
  trial: number;
  nTrials: number;
  bestValue: number;
}

export interface OptimizeWithDataResult {
  bestValue: number;
  bestParams: PipelineConfig;
  metrics: BacktestMetrics;
  nTrials: number;
}

/**
 * Pure random-search optimization over injected candle data — no network, no
 * fs, no logging. The CLI Optimizer and the browser playground both delegate
 * here; progress is reported via callback instead of a logger.
 */
export function optimizeWithData(
  data: Candle[],
  nTrials = 200,
  onProgress?: (progress: OptimizeProgress) => void,
  benchmarkData?: { spy: BenchmarkCandle[]; sector: BenchmarkCandle[] }
): OptimizeWithDataResult {
  if (data.length < 200) {
    throw new Error(`Insufficient data: ${data.length} bars`);
  }

  const backtester = new Backtester(data, benchmarkData);
  let bestValue = -Infinity;
  let bestParams: PipelineConfig | null = null;
  let bestMetrics: BacktestMetrics | null = null;

  for (let i = 0; i < nTrials; i++) {
    const params = generateRandomParams();
    const metrics = backtester.run(params);

    let value = -Infinity;
    if (metrics.maxDrawdown > 30) {
      value = -Infinity;
    } else {
      const sharpe = Number.isNaN(metrics.sharpeRatio) ? 0 : metrics.sharpeRatio;
      const dd = Number.isNaN(metrics.maxDrawdown) ? 100 : metrics.maxDrawdown;
      value = sharpe * 0.7 - (dd / 100) * 0.3;
    }

    if (value > bestValue) {
      bestValue = value;
      bestParams = params;
      bestMetrics = metrics;
    }

    onProgress?.({ trial: i + 1, nTrials, bestValue });
  }

  if (!bestParams || !bestMetrics) {
    throw new Error('Optimization failed to find valid parameters');
  }

  return { bestValue, bestParams, metrics: bestMetrics, nTrials };
}

export function generateRandomParams(): PipelineConfig {
  const r = (min: number, max: number) => Math.random() * (max - min) + min;
  const ri = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

  return {
    strategy: 'mean-reversion' as const,
    indicatorWeights: {
      rsi: r(50, 100),
      stochastic: r(50, 100),
      bollinger: r(50, 100),
      donchian: r(50, 100),
      williamsR: r(50, 100),
      fearGreed: r(20, 80),
      macd: r(50, 100),
      sma: r(50, 100),
      ema: r(50, 100),
      volume: 0,
    },
    patternWeights: {
      ascendingTriangle: r(50, 100),
      bullishFlag: r(50, 100),
      doubleBottom: r(50, 100),
      fallingWedge: r(50, 100),
      islandReversal: r(50, 100),
    },
    thresholds: {
      buy: ri(150, 250),
      sell: ri(150, 250),
    },
    calibration: {
      slope: r(0.005, 0.02),
      intercept: r(-2.0, 0.0),
    },
    trendGate: {
      enabled: true,
      minConditions: ri(1, 3),
      sidewaysThreshold: r(1, 5),
    },
    gradientRanges: {
      rsi: { max: r(10, 20), mid: r(25, 35), zero: r(35, 50) },
      stochK: { max: r(5, 15), mid: r(15, 25), zero: r(30, 45) },
      williamsR: { max: r(-95, -85), mid: r(-85, -75), zero: r(-70, -50) },
      bollingerPctB: { max: r(-0.1, 0.05), mid: r(0.05, 0.15), zero: r(0.2, 0.4) },
    },
    confluence: {
      minActive: ri(3, 6),
      activationThreshold: r(0.2, 0.5),
    },
    reversalConfirm: {
      enabled: true,
      volumeMultiplier: r(0.8, 1.5),
    },
    confidenceGate: {
      enabled: false,
      threshold: 50,
      weights: { trend: 0.25, score: 0.25, confluence: 0.25, reversal: 0.25 },
    },
    regimeFilter: {
      enabled: true,
      blockUptrend: true,
    },
    clusterFilter: {
      enabled: true,
      minGapDays: ri(3, 10),
    },
    institutional: {
      enabled: false,
      weights: {
        rsSpy: 0.25,
        rsSector: 0.25,
        vwap: 0.2,
        breakoutVol: 0.15,
        liquidity: 0.1,
        earnings: 0.05,
      },
      threshold: 0.45,
      rsLookback: { short: 63, long: 126 },
      minAvgDailyDollarVol: 5_000_000,
    },
  };
}
