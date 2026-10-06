import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
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
  dollarVolume?: number;
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
  benchmarkData?: { spy: BenchmarkCandle[]; sector: BenchmarkCandle[] },
  baseConfig: PipelineConfig = DEFAULT_QUALITY_PIPELINE_CONFIG
): OptimizeWithDataResult {
  if (!Number.isInteger(nTrials) || nTrials < 1) {
    throw new Error('Optimization trials must be a positive integer');
  }
  if (data.length < 210) {
    throw new Error(`Insufficient data: ${data.length} bars`);
  }
  assertLeaderPullbackConfig(baseConfig);

  const backtester = new Backtester(data, benchmarkData);
  let bestValue = -Infinity;
  let bestParams: PipelineConfig | null = null;
  let bestMetrics: BacktestMetrics | null = null;

  for (let i = 0; i < nTrials; i++) {
    // Include the active runtime snapshot as the first candidate. Optimization
    // changes weights and thresholds, never the leader-pullback setup rules.
    const params = i === 0 ? structuredClone(baseConfig) : generateRandomParams(baseConfig);
    const metrics = backtester.run(params);

    let value = -Infinity;
    if (
      metrics.totalTrades === 0 ||
      !Number.isFinite(metrics.sharpeRatio) ||
      !Number.isFinite(metrics.maxDrawdown) ||
      metrics.maxDrawdown > 30
    ) {
      value = -Infinity;
    } else {
      value = metrics.sharpeRatio * 0.7 - (metrics.maxDrawdown / 100) * 0.3;
    }

    if (value > bestValue) {
      bestValue = value;
      bestParams = params;
      bestMetrics = metrics;
    }

    onProgress?.({ trial: i + 1, nTrials, bestValue });
  }

  if (!bestParams || !bestMetrics) {
    throw new Error('Optimization failed to find valid parameters with observed trades');
  }

  return { bestValue, bestParams, metrics: bestMetrics, nTrials };
}

export function generateRandomParams(
  baseConfig: PipelineConfig = DEFAULT_QUALITY_PIPELINE_CONFIG
): PipelineConfig {
  const r = (min: number, max: number) => Math.random() * (max - min) + min;
  assertLeaderPullbackConfig(baseConfig);

  const config = structuredClone(baseConfig);
  const scoreCap = baseConfig.qualityGate?.scoreMax;
  const maxThreshold = scoreCap === undefined ? Infinity : Math.ceil(scoreCap) - 1;
  const sampleThreshold = (threshold: number, maximum = Infinity) =>
    Math.max(1, Math.min(maximum, Math.round(threshold * r(0.8, 1.2))));
  config.thresholds = {
    buy: sampleThreshold(baseConfig.thresholds.buy, maxThreshold),
    sell: sampleThreshold(baseConfig.thresholds.sell),
  };
  const weights = config.institutional.weights;
  const keys = Object.keys(weights) as (keyof typeof weights)[];
  for (const key of keys) weights[key] *= r(0.8, 1.2);
  const total = keys.reduce((sum, key) => sum + weights[key], 0);
  for (const key of keys) weights[key] /= total;
  return config;
}

function assertLeaderPullbackConfig(config: PipelineConfig): void {
  if (
    config.strategy !== 'institutional' ||
    !config.institutional.enabled ||
    !config.qualityGate?.enabled ||
    !config.qualityGate.requireBelowSma50 ||
    config.qualityGate.rsMin === undefined ||
    !config.trendGate.enabled ||
    config.trendGate.source !== 'gaussian' ||
    !Object.values(config.institutional.weights).every(
      (weight) => Number.isFinite(weight) && weight >= 0
    ) ||
    Object.values(config.institutional.weights).reduce((sum, weight) => sum + weight, 0) <= 0
  ) {
    throw new Error('Optimization requires the leader-pullback pipeline');
  }
}
