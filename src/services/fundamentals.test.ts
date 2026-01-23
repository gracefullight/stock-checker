import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFundamentals } from './fundamentals';
import type { FundamentalData } from '../types';

vi.mock('yahoo-finance2');

describe('fundamentals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch fundamental data successfully', async () => {
    const mockQuote = {
      trailingPE: 25.5,
      dividendYield: 1.5,
      earningsTimestamp: new Date('2026-02-01'),
      marketCap: 500000000000,
    };

    vi.mocked(yahooFinance.quote).mockResolvedValue([mockQuote as any]);

    const result = await getFundamentals('TSLA');

    expect(result.ticker).toBe('TSLA');
    expect(result.pe).toBe(25.5);
    expect(result.dividendYield).toBe(1.5);
    expect(result.nextEarningsDate).toEqual(new Date('2026-02-01'));
    expect(result.marketCap).toBe(500000000000);
  });

  it('should return null values on error', async () => {
    vi.mocked(yahooFinance.quote).mockRejectedValue(new Error('API error'));

    const result = await getFundamentals('TSLA');

    expect(result.ticker).toBe('TSLA');
    expect(result.pe).toBeNull();
    expect(result.dividendYield).toBeNull();
    expect(result.nextEarningsDate).toBeNull();
    expect(result.marketCap).toBeNull();
  });
});
