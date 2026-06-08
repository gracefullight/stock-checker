import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateEarningsSurpriseAverage, getEarningsData } from '@/services/earnings';
import yahooFinance from '@/services/yahoo-finance';

vi.mock('../yahoo-finance', () => ({
  default: {
    quoteSummary: vi.fn(),
  },
}));

describe('earnings service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEarningsData', () => {
    it('should return earnings data for a stock', async () => {
      const mockSummary = {
        calendarEvents: {
          earnings: {
            earningsDate: [new Date('2024-02-01')],
          },
        },
      };

      const mockHistory = {
        earningsHistory: {
          history: [
            {
              epsActualDate: '2023-10-25',
              epsActual: 1.26,
              epsEstimate: 1.22,
            },
            {
              epsActualDate: '2023-07-25',
              epsActual: 1.18,
              epsEstimate: 1.19,
            },
          ],
        },
      };

      const mockTrend = {
        earningsTrend: {
          trend: [
            {
              endDate: '2024-03-31',
              estimate: 1.35,
              estimateAvg: 1.33,
              estimateLow: 1.3,
              estimateHigh: 1.4,
              estimateCount: 28,
              yearAgoEps: 1.08,
            },
          ],
        },
      };

      vi.mocked(yahooFinance).quoteSummary.mockResolvedValue({
        ...mockSummary,
        ...mockHistory,
        ...mockTrend,
        // biome-ignore lint/suspicious/noExplicitAny: Mock data structure complexity
      } as any);

      const result = await getEarningsData('AAPL');

      expect(result.ticker).toBe('AAPL');
      expect(result.nextEarningsDate).toEqual(new Date('2024-02-01'));
      expect(result.earningsHistory).toHaveLength(2);
      expect(result.earningsHistory[0]).toMatchObject({
        reportDate: new Date('2023-10-25'),
        epsActual: 1.26,
        epsEstimate: 1.22,
      });
      expect(result.earningsHistory[0].epsDifference).toBeCloseTo(0.04);
      expect(result.earningsHistory[0].surprisePercent).toBeCloseTo(3.28);
      expect(result.earningsTrend).toHaveLength(1);
      expect(result.earningsTrend[0].endDate).toEqual(new Date('2024-03-31'));
      expect(result.currentQuarterEstimate).toBeNull();
      expect(result.currentYearEstimate).toBeNull();
    });

    it('should return empty data on API error', async () => {
      vi.mocked(yahooFinance).quoteSummary.mockRejectedValue(new Error('API Error'));

      const result = await getEarningsData('INVALID');

      expect(result.ticker).toBe('INVALID');
      expect(result.nextEarningsDate).toBeNull();
      expect(result.earningsHistory).toEqual([]);
      expect(result.earningsTrend).toEqual([]);
      expect(result.currentQuarterEstimate).toBeNull();
      expect(result.currentYearEstimate).toBeNull();
    });
  });

  describe('calculateEarningsSurpriseAverage', () => {
    it('should calculate average surprise from history', () => {
      const history = [
        {
          reportDate: new Date(),
          epsActual: 1.26,
          epsEstimate: 1.2,
          epsDifference: 0.06,
          surprisePercent: 5.5,
        },
        {
          reportDate: new Date(),
          epsActual: 1.18,
          epsEstimate: 1.14,
          epsDifference: 0.04,
          surprisePercent: 3.2,
        },
        {
          reportDate: new Date(),
          epsActual: 1.3,
          epsEstimate: 1.21,
          epsDifference: 0.09,
          surprisePercent: 7.8,
        },
        {
          reportDate: new Date(),
          epsActual: 1.25,
          epsEstimate: 1.22,
          epsDifference: 0.03,
          surprisePercent: 2.1,
        },
        {
          reportDate: new Date(),
          epsActual: null,
          epsEstimate: null,
          epsDifference: null,
          surprisePercent: null,
        },
      ];

      const result = calculateEarningsSurpriseAverage(history);

      expect(result).toBeCloseTo(4.65, 2);
    });

    it('should return 0 for empty history', () => {
      const result = calculateEarningsSurpriseAverage([]);

      expect(result).toBe(0);
    });

    it('should return 0 when all surprises are null', () => {
      const history = [
        {
          reportDate: new Date(),
          epsActual: null,
          epsEstimate: null,
          epsDifference: null,
          surprisePercent: null,
        },
        {
          reportDate: new Date(),
          epsActual: null,
          epsEstimate: null,
          epsDifference: null,
          surprisePercent: null,
        },
        {
          reportDate: new Date(),
          epsActual: null,
          epsEstimate: null,
          epsDifference: null,
          surprisePercent: null,
        },
      ];

      const result = calculateEarningsSurpriseAverage(history);

      expect(result).toBe(0);
    });
  });
});
