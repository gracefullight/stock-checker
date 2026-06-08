import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFundamentals } from '@/services/fundamentals';
import yahooFinance from '@/services/yahoo-finance';

vi.mock('../yahoo-finance', () => ({
  default: {
    quoteSummary: vi.fn(),
  },
}));

describe('fundamentals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch fundamental data successfully', async () => {
    const mockQuote = {
      summaryDetail: {
        trailingPE: 25.5,
        trailingAnnualDividendYield: 0.015,
      },
      price: {
        marketCap: 500000000000,
      },
      calendarEvents: {
        earnings: {
          earningsDate: [new Date('2026-02-01')],
        },
      },
    };

    // biome-ignore lint/suspicious/noExplicitAny: Mock data structure complexity
    vi.mocked(yahooFinance).quoteSummary.mockResolvedValue(mockQuote as any);

    const result = await getFundamentals('TSLA');

    expect(result.ticker).toBe('TSLA');
    expect(result.pe).toBe(25.5);
    expect(result.dividendYield).toBe(0.015);
    expect(result.nextEarningsDate).toEqual(new Date('2026-02-01'));
    expect(result.marketCap).toBe(500000000000);
  });

  it('should return null values on error', async () => {
    vi.mocked(yahooFinance).quoteSummary.mockRejectedValue(new Error('API error'));

    const result = await getFundamentals('TSLA');

    expect(result.ticker).toBe('TSLA');
    expect(result.pe).toBeNull();
    expect(result.dividendYield).toBeNull();
    expect(result.nextEarningsDate).toBeNull();
    expect(result.marketCap).toBeNull();
  });
});
