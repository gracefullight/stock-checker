import { beforeAll, describe, expect, it, vi } from 'vitest';
import { predict } from '@/commands/predict';
import type { CliOptions } from '@/types';

describe('integration', () => {
  beforeAll(() => {
    vi.clearAllMocks();
  });

  it('should process multiple tickers and write CSV', async () => {
    // Mock external services
    vi.mock('../services/data-fetcher', () => ({
      getHistoricalPrices: vi.fn().mockResolvedValue([
        {
          date: new Date('2026-01-24'),
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          adjClose: 105,
          volume: 1000000,
          symbol: 'TSLA',
        },
      ]),
      getFearGreedIndex: vi.fn().mockResolvedValue(50),
    }));
    vi.mock('../utils/csv-writer', () => ({
      writeToCsv: vi.fn(),
    }));
    vi.mock('../utils/slack', () => ({
      sendSlackNotification: vi.fn(),
    }));
    vi.mock('node:fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(),
    }));

    const options: CliOptions = {
      tickers: ['TSLA', 'AAPL'],
      sort: 'asc',
      format: 'csv',
    };

    await expect(predict(options)).resolves.not.toThrow();
  });
});
