import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseStrategyValidationArguments } from '@/commands/validate-strategy';
import type { BacktestSignal, Candle } from '@/optimization/engine';
import {
  measureStrategyValidation,
  parseStrategyCandles,
  strategyConfigFingerprint,
  validateStrategyDataset,
} from '@/reports/strategy-validation';
import { cloneCanonicalPipelineConfig } from '@/utils/config-loader';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function candles(length: number, start = '2024-01-01T00:00:00Z'): Candle[] {
  return Array.from({ length }, (_, index) => ({
    date: new Date(Date.parse(start) + index * 86_400_000),
    open: 100,
    high: 130,
    low: 80,
    close: 101,
    volume: 1_000_000,
    dollarVolume: 101_000_000,
  }));
}
function signal(rows: Candle[], index: number, ticker = 'TEST'): BacktestSignal {
  return {
    date: rows[index].date,
    ticker,
    decision: 'BUY',
    close: rows[index].close,
  } as BacktestSignal;
}

describe('fixed native strategy measurement chronology', () => {
  it('measures next-session open rather than the signal close and deducts 10 bps', () => {
    const rows = candles(7);
    rows[1].open = 120;
    rows[5].close = 110;
    const result = measureStrategyValidation([signal(rows, 0)], new Map([['TEST', rows]]));
    expect(result.full.observations).toMatchObject({ samples: 1, wins: 0, winRatePct: 0 });
    expect(result.full.observations.meanNetReturnPct).toBeCloseTo((110 / 120 - 1) * 100 - 0.1);
    expect(result.executedTrades[0]).toMatchObject({
      entryDate: '2024-01-02',
      exitDate: '2024-01-06',
      entryPrice: 120,
      exitPrice: 110,
    });
  });

  it('keeps overlapping BUY observations separate from non-overlapping ticker executions', () => {
    const rows = candles(12);
    const result = measureStrategyValidation(
      [signal(rows, 0), signal(rows, 1), signal(rows, 5), signal(rows, 11)],
      new Map([['TEST', rows]])
    );
    expect(result.rawBuySetups).toBe(4);
    expect(result.full.observations.samples).toBe(3);
    expect(result.full.nonOverlappingTrades.trades).toBe(2);
    expect(result.executedTrades.map((trade) => trade.entryDate)).toEqual([
      '2024-01-02',
      '2024-01-07',
    ]);
  });

  it('purges pre-2025 trades crossing the boundary and labels annual cohorts by entry date', () => {
    const rows = candles(12, '2024-12-28T00:00:00Z');
    const result = measureStrategyValidation(
      [signal(rows, 0), signal(rows, 5)],
      new Map([['TEST', rows]])
    );
    expect(result.boundaryPurged).toBe(1);
    expect(result.before2025.observations).toMatchObject({ samples: 0, wins: 0, winRatePct: null });
    expect(result.since2025.observations.samples).toBe(1);
    expect(result.annual[2024].observations.samples).toBe(1);
    expect(result.annual[2025].observations.samples).toBe(1);
  });

  it('marks portfolio sleeves independently and includes an intrahold close drawdown', () => {
    const first = candles(7),
      second = candles(7);
    first[2].close = 50;
    const result = measureStrategyValidation(
      [signal(first, 0, 'A')],
      new Map([
        ['A', first],
        ['B', second],
      ])
    );
    expect(result.portfolio.initialCapital).toBe(20_000);
    expect(result.portfolio.maxTickerDrawdownPct).toBeCloseTo((51 / 101) * 100);
    expect(result.portfolio.maxDrawdownPct).toBeGreaterThan(25);
    expect(result.portfolio.maxDrawdownPct).toBeLessThan(26);
  });

  it('rejects noncausal cached rows and preserves nominal dollar turnover', () => {
    const rows = JSON.parse(JSON.stringify(candles(3))) as Record<string, unknown>[];
    expect(parseStrategyCandles(rows)[0].dollarVolume).toBe(101_000_000);
    expect(() => parseStrategyCandles([rows[1], rows[0]])).toThrow('unique increasing');
    expect(() => parseStrategyCandles([rows[0], rows[0]])).toThrow('unique increasing');
    expect(() => parseStrategyCandles([{ ...rows[0], open: 0 }])).toThrow();
    const date = parseStrategyCandles(rows)[0].date;
    const original = date.toISOString();
    date.setTime(date.getTime() + 86_400_000);
    expect(date.toISOString()).not.toBe(original);
  });

  it('fingerprints complete configuration independent of key insertion order', () => {
    const config = cloneCanonicalPipelineConfig();
    const reordered = Object.fromEntries(Object.entries(config).reverse()) as typeof config;
    expect(strategyConfigFingerprint(config)).toBe(strategyConfigFingerprint(reordered));
    reordered.qualityGate = { ...reordered.qualityGate!, ibsMax: 0.19 };
    expect(strategyConfigFingerprint(config)).not.toBe(strategyConfigFingerprint(reordered));
  });
});

async function dataset() {
  const root = await mkdtemp(path.join(tmpdir(), 'stock-checker-strategy-'));
  roots.push(root);
  const source = path.join(root, 'source');
  await mkdir(source);
  await writeFile(
    path.join(source, 'range.json'),
    JSON.stringify({ start: '2024-01-01T00:00:00Z', end: '2024-12-31T23:59:59Z' })
  );
  const rows = candles(220);
  for (const ticker of ['TEST', 'TEST2', 'SPY', 'XLK'])
    await writeFile(path.join(source, `${ticker}.json`), JSON.stringify(rows));
  await writeFile(
    path.join(source, 'signals-TEST.json'),
    'This stale derived signal cache must never be read'
  );
  return { root, source, rows, output: path.join(root, 'result.json') };
}

describe('frozen raw snapshot validation', () => {
  it('freezes the exact full configuration once, preserves raw inputs and reports unavailable symbols', async () => {
    const fixture = await dataset();
    const before = await stat(path.join(fixture.source, 'TEST.json'));
    const loadConfig = vi.fn(async () => cloneCanonicalPipelineConfig());
    const evaluate = vi.fn(async (ticker, rows: Candle[], _spy, _sector, config) => {
      expect(Object.isFrozen(config)).toBe(true);
      expect(Object.isFrozen(config.qualityGate)).toBe(true);
      expect(await readFile(path.join(fixture.root, 'result-inputs/TEST.json'), 'utf8')).toBe(
        await readFile(path.join(fixture.source, 'TEST.json'), 'utf8')
      );
      return [signal(rows, 205, ticker)];
    });
    const { report, snapshotDirectory } = await validateStrategyDataset(
      { datasetDirectory: fixture.source, outputFile: fixture.output, workers: 1 },
      { universe: { TEST: 'XLK', MISSING: 'XLK' }, loadConfig, evaluate }
    );
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({
      requestedTickers: 2,
      evaluatedTickers: 1,
      unavailableTickers: 1,
      independentOutOfSample: false,
      sourceChangedDuringMeasurement: false,
      pipelineConfigVersion: '3.0.0',
      strategyId: 'leader-pullback-v1',
    });
    expect(report.full.observations.samples).toBe(1);
    expect(report.failures).toContainEqual({ ticker: 'MISSING', reason: 'missing-input' });
    expect(report.observedInputRange.lastSession).toBe(fixture.rows.at(-1)!.date.toISOString());
    expect(report.requestedRange.end).toBe('2024-12-31T23:59:59Z');
    expect((await stat(path.join(fixture.source, 'TEST.json'))).mtimeMs).toBe(before.mtimeMs);
    expect((await stat(path.join(snapshotDirectory, 'manifest.json'))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(fixture.output, 'utf8')).configSha256).toBe(
      report.configSha256
    );
  });

  it('requires explicit dataset paths and rejects ambiguous flags', () => {
    expect(
      parseStrategyValidationArguments([
        '--dataset=/tmp/frozen',
        '--workers=2',
        '--tickers=oii,aapl',
      ])
    ).toMatchObject({ datasetDirectory: '/tmp/frozen', workers: 2, tickers: ['OII', 'AAPL'] });
    for (const arguments_ of [
      [],
      ['--dataset=relative'],
      ['--dataset=/tmp/x', '--workers=0'],
      ['--dataset=/tmp/x', '--workers=7'],
      ['--dataset=/tmp/x', '--dataset=/tmp/y'],
    ])
      expect(() => parseStrategyValidationArguments(arguments_)).toThrow();
  });

  it('clamps engine inputs to the requested session range while preserving the original raw snapshot', async () => {
    const fixture = await dataset();
    await writeFile(
      path.join(fixture.source, 'range.json'),
      JSON.stringify({
        start: fixture.rows[0].date.toISOString(),
        end: fixture.rows[211].date.toISOString(),
      })
    );
    const evaluate = vi.fn(async (ticker, rows: Candle[]) => {
      expect(rows).toHaveLength(212);
      return [signal(rows, 206, ticker), signal(rows, 209, ticker)];
    });
    const { report, snapshotDirectory } = await validateStrategyDataset(
      { datasetDirectory: fixture.source, outputFile: fixture.output, workers: 1 },
      {
        universe: { TEST: 'XLK' },
        loadConfig: async () => cloneCanonicalPipelineConfig(),
        evaluate,
      }
    );
    expect(report.full.observations.samples).toBe(1);
    expect(report.inputs.find((input) => input.symbol === 'TEST')).toMatchObject({
      sourceSessions: 220,
      sessions: 212,
      excludedSessions: 8,
    });
    expect(
      JSON.parse(await readFile(path.join(snapshotDirectory, 'TEST.json'), 'utf8'))
    ).toHaveLength(220);
    expect(report.observedInputRange.lastSession).toBe(fixture.rows[211].date.toISOString());
  });

  it('runs the actual native engine in isolated Bun workers with the same result as sequential evaluation', async () => {
    const fixture = await dataset();
    const run = promisify(execFile);
    const moduleUrl = pathToFileURL(path.join(import.meta.dirname, 'strategy-validation.ts')).href;
    const configUrl = pathToFileURL(
      path.join(import.meta.dirname, '../utils/config-loader.ts')
    ).href;
    const script = `import {validateStrategyDataset} from ${JSON.stringify(moduleUrl)}; import {cloneCanonicalPipelineConfig} from ${JSON.stringify(configUrl)}; const deps={universe:{TEST:'XLK',TEST2:'XLK'},loadConfig:async()=>cloneCanonicalPipelineConfig()}; const one=await validateStrategyDataset({datasetDirectory:${JSON.stringify(fixture.source)},outputFile:${JSON.stringify(path.join(fixture.root, 'one.json'))},workers:1},deps); const two=await validateStrategyDataset({datasetDirectory:${JSON.stringify(fixture.source)},outputFile:${JSON.stringify(path.join(fixture.root, 'two.json'))},workers:2},deps); console.log(JSON.stringify({one:one.report.full,two:two.report.full,evaluated:two.report.evaluatedTickers}));`;
    const result = await run('bun', ['--eval', script], {
      cwd: path.resolve(import.meta.dirname, '../..'),
      timeout: 10_000,
      maxBuffer: 65_536,
    });
    const output = JSON.parse(result.stdout.trim());
    expect(output.evaluated).toBe(2);
    expect(output.one).toEqual(output.two);
  }, 15_000);
});
