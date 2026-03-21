import pino from 'pino';
import { Backtester } from '@/optimization/backtester';
import { DataLoader } from '@/optimization/data-loader';
import type { OptimizationParams, OptimizationResult } from '@/optimization/types';

const logger = pino({
  level: 'info',
  transport: { target: 'pino-pretty' },
});

export class Optimizer {
  private strategyName: string = 'stock_checker_score';

  constructor(strategyName?: string) {
    if (strategyName) this.strategyName = strategyName;
  }

  public async optimize(
    symbol: string,
    nTrials: number = 200,
    _dataDir?: string
  ): Promise<OptimizationResult> {
    logger.info(`Starting optimization for ${this.strategyName} on ${symbol}...`);

    const data = await DataLoader.loadHistoricalData(symbol);
    if (data.length < 200) {
      throw new Error(`Insufficient data for ${symbol}: ${data.length} bars`);
    }

    const backtester = new Backtester(data);
    let bestValue = -Infinity;
    let bestParams: OptimizationParams | null = null;
    let bestMetrics = null;

    for (let i = 0; i < nTrials; i++) {
      const params = this.generateRandomParams();
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
        logger.info(
          `New Best Trial ${i}: Value=${value.toFixed(4)}, Sharpe=${metrics.sharpeRatio.toFixed(2)}, DD=${metrics.maxDrawdown.toFixed(2)}%`
        );
      }

      if (i % 10 === 0) logger.debug(`Trial ${i}/${nTrials} complete.`);
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
