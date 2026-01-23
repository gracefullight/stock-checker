import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import path from 'node:path';
import { writeToCsv } from './csv-writer';
import type { TickerResult } from '../types';

vi.mock('node:fs');
vi.mock('node:fs/promises');
vi.mock('node:path');

describe('csv-writer', () => {
  it('should write CSV header if file does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);
    vi.mocked(path.join).mockReturnValue('public/stock_data_20260124.csv');

    await writeToCsv([]);

    expect(fsPromises.mkdir).toHaveBeenCalledWith('public', { recursive: true });
    expect(fsPromises.appendFile).toHaveBeenCalled();
  });

  it('should format ticker result as CSV row', async () => {
    const data: TickerResult[] = [{
      ticker: 'TSLA',
      date: '2026-01-24',
      close: 200,
      volume: 1000000,
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
    }];

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);

    await writeToCsv(data);

    const appendCall = vi.mocked(fsPromises.appendFile).mock.calls[0];
    expect(appendCall[1]).toContain('TSLA');
    expect(appendCall[1]).toContain('200.00');
  });
});
