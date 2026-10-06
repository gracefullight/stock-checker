import pino from 'pino';
import { MARKET_BENCHMARK } from '@/constants';
import { TICKER_SECTOR_ETF } from '@/constants/tickers';
import { DataLoader } from '@/optimization/data-loader';
import { optimizeWithData } from '@/optimization/optimizer-core';
import type { OptimizationResult } from '@/optimization/types';
import { loadPipelineConfig } from '@/utils/config-loader';

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

    const baseConfig = await loadPipelineConfig();
    const sectorEtf = TICKER_SECTOR_ETF[symbol];
    if (!sectorEtf) {
      throw new Error(`Sector benchmark unavailable for ${symbol}`);
    }
    const [data, spy, sector] = await Promise.all([
      DataLoader.loadHistoricalData(symbol),
      DataLoader.loadHistoricalData(MARKET_BENCHMARK),
      DataLoader.loadHistoricalData(sectorEtf),
    ]);
    if (data.length < 210) {
      throw new Error(`Insufficient data for ${symbol}: ${data.length} bars`);
    }
    const requiredBenchmarkBars = baseConfig.institutional.rsLookback.long + 1;
    if (spy.length < requiredBenchmarkBars || sector.length < requiredBenchmarkBars) {
      throw new Error(`Insufficient market or sector benchmark history for ${symbol}`);
    }

    let lastBest = -Infinity;
    const result = optimizeWithData(
      data,
      nTrials,
      ({ trial, bestValue }) => {
        if (bestValue > lastBest) {
          lastBest = bestValue;
          logger.info(`New Best Trial ${trial - 1}: Value=${bestValue.toFixed(4)}`);
        }
        if ((trial - 1) % 10 === 0) logger.debug(`Trial ${trial - 1}/${nTrials} complete.`);
      },
      { spy, sector },
      baseConfig
    );

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
