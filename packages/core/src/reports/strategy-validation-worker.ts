import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { buildTickerContext, type Candle, runSignalsWithContext } from '@/optimization/engine';
import {
  parseStrategyCandles,
  type StrategyValidationSessionRange,
  selectStrategyCandles,
} from '@/reports/strategy-validation';
import type { PipelineConfig } from '@/types';

const settings = workerData as {
  snapshotDirectory: string;
  universe: Record<string, string>;
  config: PipelineConfig;
  sessionRange: StrategyValidationSessionRange;
};
const benchmarks = new Map<string, Candle[]>();
function read(symbol: string): Candle[] {
  return selectStrategyCandles(
    parseStrategyCandles(
      JSON.parse(readFileSync(path.join(settings.snapshotDirectory, `${symbol}.json`), 'utf8'))
    ),
    settings.sessionRange
  );
}
function benchmark(symbol: string): Candle[] {
  if (!benchmarks.has(symbol)) benchmarks.set(symbol, read(symbol));
  return benchmarks.get(symbol)!;
}

parentPort?.on('message', (message: { ticker?: string; done?: boolean }) => {
  if (message.done) {
    parentPort?.close();
    return;
  }
  const ticker = message.ticker;
  if (!ticker || !Object.hasOwn(settings.universe, ticker)) return;
  try {
    const context = buildTickerContext(
      read(ticker),
      benchmark('SPY'),
      benchmark(settings.universe[ticker])
    );
    if (!context) throw new Error('Insufficient context');
    const signals = runSignalsWithContext(context, ticker, settings.config)
      .filter((signal) => signal.decision === 'BUY')
      .map((signal) => ({ ...signal, date: signal.date.toISOString() }));
    parentPort?.postMessage({ ticker, signals });
  } catch {
    parentPort?.postMessage({ ticker, failed: true });
  }
});
parentPort?.postMessage({ ready: true });
