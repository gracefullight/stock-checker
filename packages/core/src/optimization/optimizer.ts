import pino from 'pino';
import { DataLoader } from '@/optimization/data-loader';
import { optimizeWithData } from '@/optimization/optimizer-core';
import type { OptimizationResult } from '@/optimization/types';

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

    let lastBest = -Infinity;
    const result = optimizeWithData(data, nTrials, ({ trial, bestValue }) => {
      if (bestValue > lastBest) {
        lastBest = bestValue;
        logger.info(`New Best Trial ${trial - 1}: Value=${bestValue.toFixed(4)}`);
      }
      if ((trial - 1) % 10 === 0) logger.debug(`Trial ${trial - 1}/${nTrials} complete.`);
    });

    return {
      strategy: this.strategyName,
      symbol,
      bestValue: result.bestValue,
      bestParams: result.bestParams,
      nTrials,
      metrics: result.metrics,
    };
  }
}
