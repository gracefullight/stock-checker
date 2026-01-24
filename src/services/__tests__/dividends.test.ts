import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateAnnualizedDividend, getDividendInfo } from '@/services/dividends';
import yahooFinance from '@/services/yahoo-finance';

vi.mock('../yahoo-finance', () => ({
  default: {
    quoteSummary: vi.fn(),
    historical: vi.fn(),
  },
}));

describe('dividends service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDividendInfo', () => {
    it('should return dividend data for a stock with dividends', async () => {
      const mockSummary = {
        summaryDetail: {
          trailingAnnualDividendYield: 0.015,
          dividendRate: 0.92,
          payoutRatio: 0.45,
        },
        financialData: undefined,
      };

      const mockDividendHistory = [
        { date: new Date('2024-01-25'), dividends: 0.24 },
        { date: new Date('2024-02-25'), dividends: 0.24 },
        { date: new Date('2023-11-25'), dividends: 0.24 },
        { date: new Date('2023-08-25'), dividends: 0.24 },
      ];

      vi.mocked(yahooFinance).quoteSummary.mockResolvedValue(mockSummary);
      vi.mocked(yahooFinance).historical.mockResolvedValue(mockDividendHistory);

      const result = await getDividendInfo('AAPL');

      expect(result.ticker).toBe('AAPL');
      expect(result.dividendYield).toBe(0.015);
      expect(result.payoutRatio).toBe(0.45);
      expect(result.annualDividendRate).toBe(0.92);
      expect(result.lastDividendDate).toEqual(new Date('2024-01-25'));
      expect(result.dividendHistory).toHaveLength(4);
      expect(result.dividendHistory[0].amount).toBe(0.24);
    });

    it('should return null values when API fails', async () => {
      vi.mocked(yahooFinance).quoteSummary.mockRejectedValue(new Error('API Error'));
      vi.mocked(yahooFinance).historical.mockResolvedValue([]);

      const result = await getDividendInfo('INVALID');

      expect(result.ticker).toBe('INVALID');
      expect(result.dividendYield).toBeNull();
      expect(result.payoutRatio).toBeNull();
      expect(result.lastDividendDate).toBeNull();
      expect(result.dividendHistory).toEqual([]);
    });
  });

  describe('calculateAnnualizedDividend', () => {
    it('should calculate annualized dividend from history', () => {
      const history = [
        { date: new Date('2024-01-25'), amount: 0.24 },
        { date: new Date('2023-11-25'), amount: 0.24 },
        { date: new Date('2023-08-25'), amount: 0.24 },
        { date: new Date('2023-05-25'), amount: 0.24 },
      ];

      const result = calculateAnnualizedDividend(history);

      const totalDividends = 0.96;
      expect(result).toBeGreaterThan(totalDividends);
    });

    it('should return 0 for empty history', () => {
      const result = calculateAnnualizedDividend([]);

      expect(result).toBe(0);
    });
  });
});
