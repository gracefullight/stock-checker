import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import { strategyConfigFingerprint } from '@/utils/config-fingerprint';
import { getSignalHistory, SIGNAL_HISTORY_VALIDATED_FROM } from '@/utils/signal-history';

const CURRENT = strategyConfigFingerprint(DEFAULT_QUALITY_PIPELINE_CONFIG);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function directory(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'stock-checker-signal-history-'));
  roots.push(root);
  for (const [name, content] of Object.entries(files))
    await writeFile(path.join(root, name), content);
  return root;
}

describe('signal history reader', () => {
  it('tolerates ragged legacy rows and keeps the last row per (Date, Ticker)', async () => {
    const dir = await directory({
      'stock_data_202610.csv': [
        'Date,Ticker,Close,Opinion,StrategyId,ConfigSha256',
        '2026-10-07,TSLA,100,HOLD',
        `2026-10-07,TSLA,100,BUY,leader-pullback-v1,${CURRENT}`,
        `2026-10-08,TSLA,101,SELL,leader-pullback-v1,${CURRENT},unexpected-extra`,
        `2026-10-08,PLTR,20,BUY,leader-pullback-v1,${CURRENT}`,
      ].join('\n'),
    });
    expect(getSignalHistory('TSLA', '2026-10-01', { directory: dir })).toEqual([
      { date: '2026-10-07', opinion: 'BUY' },
      { date: '2026-10-08', opinion: 'SELL' },
    ]);
  });

  it('drops rows before the validation date or from another configuration unless legacy rows are requested', async () => {
    const dir = await directory({
      'stock_data_202609.csv': ['Date,Ticker,Close,Opinion', '2026-09-30,TSLA,100,BUY'].join('\n'),
      'stock_data_202610.csv': [
        'Date,Ticker,Close,Opinion,StrategyId,ConfigSha256',
        '2026-10-05,TSLA,100,BUY,,',
        '2026-10-06,TSLA,100,BUY,,',
        `2026-10-07,TSLA,100,BUY,leader-pullback-v1,${'0'.repeat(64)}`,
        `2026-10-08,TSLA,100,BUY,leader-pullback-v1,${CURRENT}`,
      ].join('\n'),
    });
    expect(SIGNAL_HISTORY_VALIDATED_FROM).toBe('2026-10-06');
    expect(getSignalHistory('TSLA', '2026-09-01', { directory: dir })).toEqual([
      { date: '2026-10-06', opinion: 'BUY' },
      { date: '2026-10-08', opinion: 'BUY' },
    ]);
    expect(getSignalHistory('TSLA', '2026-09-01', { directory: dir, includeLegacy: true })).toEqual(
      [
        { date: '2026-09-30', opinion: 'BUY', legacy: true },
        { date: '2026-10-05', opinion: 'BUY', legacy: true },
        { date: '2026-10-06', opinion: 'BUY' },
        { date: '2026-10-07', opinion: 'BUY', legacy: true },
        { date: '2026-10-08', opinion: 'BUY' },
      ]
    );
    expect(
      getSignalHistory('TSLA', '2026-10-07', { directory: dir, configSha256: '0'.repeat(64) })
    ).toEqual([{ date: '2026-10-07', opinion: 'BUY' }]);
  });

  it('returns nothing for a missing directory', () => {
    expect(getSignalHistory('TSLA', '2026-10-01', { directory: '/nonexistent/csv' })).toEqual([]);
  });
});
