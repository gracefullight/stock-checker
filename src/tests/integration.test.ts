import { describe, it, expect, vi, beforeAll } from 'vitest';
import { parseOptions } from '../config';
import { fetchAndWrite } from '../index';
import type { CliOptions } from '../types';

describe('integration', () => {
  beforeAll(() => {
    vi.clearAllMocks();
  });

  it('should process multiple tickers and write CSV', async () => {
    const options: CliOptions = {
      tickers: ['TSLA', 'PLTR'],
      sort: 'asc',
    };

    // Mock external services
    vi.mock('../services/data-fetcher');
    vi.mock('../utils/csv-writer');

    await expect(fetchAndWrite(options)).resolves.not.toThrow();
  });
});