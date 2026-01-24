export interface OptimizationParams {
  indicatorWeights: {
    rsi: number;
    stochastic: number;
    bollinger: number;
    donchian: number;
    williamsR: number;
    fearGreed: number;
    macd: number;
    sma: number;
    ema: number;
  };
  patternWeights: {
    ascendingTriangle: number;
    bullishFlag: number;
    doubleBottom: number;
    fallingWedge: number;
    islandReversal: number;
  };
  thresholds: {
    buy: number;
    sell: number;
  };
  calibration: {
    slope: number;
    intercept: number;
  };
}

export interface OptimizationResult {
  strategy: string;
  symbol: string;
  bestValue: number;
  bestParams: OptimizationParams;
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
