import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBacktestBaselineConfig, runBacktestBaseline } from '@/commands/backtest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import * as engine from '@/optimization/engine';
import { loadPipelineConfig, savePipelineConfig } from '@/utils/config-loader';

describe('production backtest configuration', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads the same complete active snapshot as the runtime rather than a hardcoded variant', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stock-checker-backtest-'));
    const configPath = join(directory, 'optimized_weights.json');
    try {
      const config = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
      config.thresholds = { buy: 185, sell: 145 };
      config.institutional.weights.rsSpy = 0.35;
      config.institutional.weights.rsSector = 0.2;
      await savePipelineConfig(config, { configPath });
      const runtime = await loadPipelineConfig({ configPath });
      const baseline = await resolveBacktestBaselineConfig({ configPath });
      expect(baseline).toEqual(runtime);
      expect(baseline).toEqual(config);
      expect(baseline.thresholds).not.toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG.thresholds);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('applies the same full frozen config to every ticker before measuring next-open net returns', () => {
    const config = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    config.thresholds = { buy: 185, sell: 145 };
    const bars = Array.from({ length: 7 }, (_, i) => ({
      date: new Date(Date.UTC(2025, 0, i + 1)),
      open: i === 1 ? 110 : 100,
      high: 121,
      low: 99,
      close: i === 5 ? 121 : 100,
      volume: 1_000_000,
    }));
    const contexts = new Map([
      ['AAPL', { data: bars } as engine.TickerContext],
      ['MSFT', { data: bars } as engine.TickerContext],
    ]);
    const run = vi
      .spyOn(engine, 'runSignalsWithContext')
      .mockImplementation((_ctx, ticker) => [
        { date: bars[0].date, ticker, close: 100, decision: 'BUY' } as engine.BacktestSignal,
      ]);
    const result = runBacktestBaseline(
      contexts,
      new Map([
        ['AAPL', bars],
        ['MSFT', bars],
      ]),
      config
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.every(([, , actualConfig]) => actualConfig === config)).toBe(true);
    expect(result.result.wins).toBe(2);
    expect(result.result.totalSignals).toBe(2);
    // Entry 110 at the next open, exit 121 after five sessions, minus 10bps.
    expect(result.result.avgReturn).toBeCloseTo(9.9, 8);
  });
});
