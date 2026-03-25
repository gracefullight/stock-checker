import type { PipelineConfig } from '@/types';

/** @deprecated Use PipelineConfig instead */
export type OptimizationParams = PipelineConfig;

export interface OptimizationResult {
  strategy: string;
  symbol: string;
  bestValue: number;
  bestParams: PipelineConfig;
  nTrials: number;
  metrics: BacktestMetrics;
}

export interface BacktestMetrics {
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  profitFactor: number;
  return: number;
}

export interface OptimizationConfig {
  dataDir: string;
  outputDir: string;
  strategyName: string;
  nTrials: number;
}
