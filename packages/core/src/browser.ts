/**
 * Browser-safe entry point. Pure compute only — importing ANY module that
 * touches fs / network / pino here breaks the Web Worker bundle. Guarded by
 * src/__tests__/browser-purity.test.ts.
 */
import {
  type BacktestSignal,
  buildEquityCurve,
  buildTickerContext,
  type Candle,
  type EquityCurveResult,
  measure5DayWinRate,
  runSignalsWithContext,
  type WinRateResult,
} from '@/optimization/engine';
import {
  type OptimizeProgress,
  type OptimizeWithDataResult,
  optimizeWithData,
} from '@/optimization/optimizer-core';
import type { BenchmarkCandle, PipelineConfig } from '@/types';

export {
  DEFAULT_INSTITUTIONAL_PIPELINE_CONFIG,
  DEFAULT_QUALITY_PIPELINE_CONFIG,
} from '@/constants';
export type { BenchmarkCandle, PipelineConfig } from '@/types';
export type {
  BacktestSignal,
  Candle,
  EquityCurveResult,
  OptimizeProgress,
  OptimizeWithDataResult,
  WinRateResult,
};
export { optimizeWithData };

export interface RunBacktestResult {
  winRate: WinRateResult;
  equityCurve: EquityCurveResult;
  signals: BacktestSignal[];
}

/**
 * Run the full quality-pipeline backtest for one ticker on injected data —
 * identical code paths to the CLI backtest (context build → signal loop →
 * 5-day win-rate + compounded equity curve).
 */
export function runBacktest(
  ticker: string,
  candles: Candle[],
  spy: BenchmarkCandle[],
  sector: BenchmarkCandle[],
  config: PipelineConfig
): RunBacktestResult | null {
  const ctx = buildTickerContext(candles, spy, sector);
  if (!ctx) return null;

  const signals = runSignalsWithContext(ctx, ticker, config);
  const priceData = new Map([[ticker, candles.map((d) => ({ date: d.date, close: d.close }))]]);
  const winRate = measure5DayWinRate(signals, priceData);
  const equityCurve = buildEquityCurve(
    signals,
    candles.map((d) => ({ date: d.date, close: d.close }))
  );

  return { winRate, equityCurve, signals };
}
