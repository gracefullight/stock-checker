import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TickerResult } from '@/types';
import { CSV_HEADER, writeToCsv } from '@/utils/csv-writer';

vi.mock('@/utils/config-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/config-loader')>();
  return {
    ...actual,
    loadPipelineConfig: vi.fn(async () => actual.cloneCanonicalPipelineConfig()),
  };
});

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function directory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'stock-checker-csv-'));
  roots.push(root);
  return root;
}
function result(overrides: Partial<TickerResult> = {}): TickerResult {
  return {
    ticker: 'TSLA',
    date: '2026-10-14',
    close: 200,
    volume: 1_000_000,
    rsi: 50,
    stochasticK: 50,
    bbLower: 190,
    bbUpper: 210,
    donchLower: 185,
    donchUpper: 215,
    williamsR: -50,
    fearGreed: 50,
    patterns: [],
    score: 100,
    opinion: 'HOLD',
    atr: 5,
    stopLoss: 195,
    takeProfit: 205,
    trailingStop: 195,
    trailingStart: 202.5,
    macd: 0,
    macdSignal: 0,
    macdHistogram: 0,
    sma20: 195,
    ema20: 195,
    ...overrides,
  };
}
const SHA = 'a'.repeat(64);
const lines = async (file: string) => (await readFile(file, 'utf-8')).trim().split('\n');

describe('csv-writer', () => {
  it('writes the header with strategy identity columns and stamps every row', async () => {
    const dir = await directory();
    await writeToCsv([result()], {
      directory: dir,
      month: '202610',
      strategyId: 'leader-pullback-v1',
      configSha256: SHA,
    });
    const rows = await lines(path.join(dir, 'stock_data_202610.csv'));
    expect(rows[0]).toBe(CSV_HEADER.join(','));
    expect(rows[0].endsWith(',StrategyId,ConfigSha256')).toBe(true);
    expect(rows[1].split(',')).toHaveLength(CSV_HEADER.length);
    expect(rows[1]).toContain('TSLA');
    expect(rows[1]).toContain('200.00');
    expect(rows[1].endsWith(`,leader-pullback-v1,${SHA}`)).toBe(true);
  });

  it('upserts on (Date, Ticker, ConfigSha256) and pads legacy rows instead of rewriting them', async () => {
    const dir = await directory();
    const file = path.join(dir, 'stock_data_202610.csv');
    await writeFile(
      file,
      `${CSV_HEADER.slice(0, 32).join(',')}\n2026-10-13,TSLA,150.00,1,${Array(28).fill('0').join(',')}\n`
    );
    const options = { directory: dir, month: '202610', strategyId: 'leader-pullback-v1' };
    await writeToCsv([result({ opinion: 'HOLD' })], { ...options, configSha256: SHA });
    await writeToCsv(
      [result({ opinion: 'BUY', close: 201 }), result({ ticker: 'PLTR', date: '2026-10-14' })],
      { ...options, configSha256: SHA }
    );
    await writeToCsv([result({ opinion: 'SELL' })], { ...options, configSha256: 'b'.repeat(64) });
    const rows = (await lines(file)).map((row) => row.split(','));
    expect(rows[0]).toEqual([...CSV_HEADER]);
    expect(rows.slice(1).map((row) => [row[0], row[1], row[14], row[33]])).toEqual([
      ['2026-10-13', 'TSLA', '0', ''],
      ['2026-10-14', 'TSLA', 'BUY', SHA],
      ['2026-10-14', 'PLTR', 'HOLD', SHA],
      ['2026-10-14', 'TSLA', 'SELL', 'b'.repeat(64)],
    ]);
    expect(rows[1]).toHaveLength(CSV_HEADER.length);
    expect(rows[2][2]).toBe('201.00');
  });

  it('fingerprints the loaded pipeline configuration when no identity is supplied', async () => {
    const { loadPipelineConfig } = await import('@/utils/config-loader');
    const { strategyConfigFingerprint } = await import('@/utils/config-fingerprint');
    const { DEFAULT_QUALITY_PIPELINE_CONFIG } = await import('@/constants');
    const dir = await directory();
    await writeToCsv([result()], { directory: dir, month: '202610' });
    expect(loadPipelineConfig).toHaveBeenCalled();
    const rows = await lines(path.join(dir, 'stock_data_202610.csv'));
    expect(
      rows[1].endsWith(
        `,leader-pullback-v1,${strategyConfigFingerprint(DEFAULT_QUALITY_PIPELINE_CONFIG)}`
      )
    ).toBe(true);
  });
});
