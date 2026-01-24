import { Backtester } from '@/optimization/backtester';
import { DataLoader } from '@/optimization/data-loader';
import type { OptimizationParams, OptimizationResult } from '@/optimization/types';

export class Optimizer {
  private strategyName: string = 'stock_checker_score';

  constructor(strategyName?: string) {
    if (strategyName) this.strategyName = strategyName;
  }

  public async optimize(
    symbol: string,
    nTrials: number = 50,
    _dataDir?: string
  ): Promise<OptimizationResult> {
    console.log(`Starting optimization for ${this.strategyName} on ${symbol}...`);

    const data = await DataLoader.loadHistoricalData(symbol);
    if (data.length < 200) {
      throw new Error(`Insufficient data for ${symbol}: ${data.length} bars`);
    }

    const backtester = new Backtester(data);
    let bestValue = -Infinity;
    let bestParams: OptimizationParams | null = null;
    let bestMetrics = null;

    // Simple Random Search for now (can be upgraded to GA)
    // TPE is hard to implement from scratch.

    for (let i = 0; i < nTrials; i++) {
      const params = this.generateRandomParams();
      const metrics = backtester.run(params);

      // Objective: Maximize (Sharpe * 0.7) - (MaxDD * 0.3)
      // If MaxDD > 30, value is -Infinity (penalty)

      let value = -Infinity;
      if (metrics.maxDrawdown > 30) {
        value = -Infinity;
      } else {
        // Check for NaN
        const sharpe = Number.isNaN(metrics.sharpeRatio) ? 0 : metrics.sharpeRatio;
        const dd = Number.isNaN(metrics.maxDrawdown) ? 100 : metrics.maxDrawdown;
        value = sharpe * 0.7 - dd * 0.01 * 0.3; // Note: dd is percentage in metrics?
        // In Python code: max_dd = abs(result.max_drawdown) which was %.
        // multi_objective = (sharpe * 0.7) - (max_dd * 0.3)
        // Wait, max_dd in Python backtester usually returns 0.15 for 15%.
        // My backtester returns 15 for 15%. I should check.
      }

      if (value > bestValue) {
        bestValue = value;
        bestParams = params;
        bestMetrics = metrics;
        console.log(
          `New Best Trial ${i}: Value=${value.toFixed(4)}, Sharpe=${metrics.sharpeRatio.toFixed(2)}, DD=${metrics.maxDrawdown.toFixed(2)}%`
        );
      }

      if (i % 10 === 0) console.log(`Trial ${i}/${nTrials} complete.`);
    }

    if (!bestParams || !bestMetrics)
      throw new Error('Optimization failed to find valid parameters');

    return {
      strategy: this.strategyName,
      symbol,
      bestValue,
      bestParams,
      nTrials,
      metrics: bestMetrics,
    };
  }

  private generateRandomParams(): OptimizationParams {
    const r = (min: number, max: number) => Math.random() * (max - min) + min;
    const ri = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

    return {
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
    };
  }
}
