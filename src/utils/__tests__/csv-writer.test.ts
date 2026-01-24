import fs, { promises as fsPromises } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TickerResult } from '@/types';
import { writeToCsv } from '@/utils/csv-writer';

vi.mock('node:fs', () => {
  const mockExistsSync = vi.fn();
  const mockFsPromises = {
    appendFile: vi.fn(),
    mkdir: vi.fn(),
  };
  return {
    promises: mockFsPromises,
    existsSync: mockExistsSync,
    default: {
      existsSync: mockExistsSync,
      promises: mockFsPromises,
      // Add other methods if necessary
    },
  };
});

vi.mock('node:path', () => ({
  default: {
    // default export handling
    join: vi.fn((...args) => args.join('/')),
  },
  join: vi.fn((...args) => args.join('/')), // named export handling
}));

describe('csv-writer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should write CSV header if file does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);

    const mockData = [
      {
        ticker: 'TEST',
        date: '2026-01-24',
        close: 100,
        volume: 1000,
        rsi: 50,
        stochasticK: 50,
        bbLower: 90,
        bbUpper: 110,
        donchLower: 95,
        donchUpper: 105,
        williamsR: -50,
        fearGreed: 50,
        patterns: [],
        score: 50,
        opinion: 'HOLD',
        atr: 2,
        stopLoss: 95,
        takeProfit: 105,
        trailingStop: 95,
        trailingStart: 100,
        macd: 0,
        macdSignal: 0,
        macdHistogram: 0,
        sma20: 100,
        ema20: 100,
      },
    ];

    await writeToCsv(mockData);

    expect(vi.mocked(fs.existsSync)).toHaveBeenCalledWith('public');
    expect(vi.mocked(fsPromises.mkdir)).toHaveBeenCalledWith('public', { recursive: true });
    expect(vi.mocked(fsPromises.appendFile)).toHaveBeenCalled();
  });

  it('should format ticker result as CSV row', async () => {
    const data: TickerResult[] = [
      {
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
        macd: 0,
        macdSignal: 0,
        macdHistogram: 0,
        sma20: 195,
        ema20: 195,
      },
    ];

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);

    await writeToCsv(data);

    expect(vi.mocked(fsPromises.appendFile)).toHaveBeenCalled();
    const appendCall = vi.mocked(fsPromises.appendFile).mock.calls[0];
    expect(appendCall[1]).toContain('TSLA');
    expect(appendCall[1]).toContain('200.00');
  });
});
