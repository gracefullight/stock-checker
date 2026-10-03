import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateEarningsSurpriseAverage,
  formatEarningsData,
  getEarningsData,
} from '@/services/earnings';
import yahooFinance from '@/services/yahoo-finance';

vi.mock('@/services/yahoo-finance', () => ({
  default: {
    quoteSummary: vi.fn(),
  },
}));

describe('earnings service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEarningsData', () => {
    it('sorts history chronologically so the last row is the latest reported result', async () => {
      vi.mocked(yahooFinance).quoteSummary.mockResolvedValue({
        earningsHistory: {
          history: [
            { epsActualDate: '2026-06-30', epsActual: 2, epsEstimate: 1 },
            { epsActualDate: '2026-03-31', epsActual: 1, epsEstimate: 2 },
          ],
        },
      } as never);

      const result = await getEarningsData('AAPL');

      expect(result.earningsHistory.at(-1)?.epsActual).toBe(2);
      expect(result.earningsHistory[0].reportDate.toISOString()).toBe('2026-03-31T00:00:00.000Z');
    });

    it('reads standard Yahoo fiscal-quarter history without inventing publication dates', async () => {
      vi.mocked(yahooFinance).quoteSummary.mockResolvedValue({
        earningsHistory: {
          history: [{ quarter: new Date('2026-03-31'), epsActual: -1, epsEstimate: -2 }],
        },
      } as never);

      const result = await getEarningsData('AAPL');

      expect(result.earningsHistory).toHaveLength(1);
      expect(result.earningsHistory[0]).toMatchObject({
        dateBasis: 'fiscal-quarter',
        epsActual: -1,
        epsEstimate: -2,
        epsDifference: 1,
        surprisePercent: 50,
      });
      expect(formatEarningsData(result)).toContain('2026-03-31 (quarter):');
    });

    it.each([
      { epsActual: Number.NaN, epsEstimate: 2, expectedActual: null, expectedEstimate: 2 },
      {
        epsActual: 1,
        epsEstimate: Number.POSITIVE_INFINITY,
        expectedActual: 1,
        expectedEstimate: null,
      },
    ])(
      'treats non-finite EPS as unknown: %j',
      async ({ epsActual, epsEstimate, expectedActual, expectedEstimate }) => {
        vi.mocked(yahooFinance).quoteSummary.mockResolvedValue({
          earningsHistory: { history: [{ epsActualDate: '2026-03-31', epsActual, epsEstimate }] },
        } as never);

        const result = await getEarningsData('AAPL');

        expect(result.earningsHistory[0]).toMatchObject({
          epsActual: expectedActual,
          epsEstimate: expectedEstimate,
          epsDifference: null,
          surprisePercent: null,
        });
        expect(formatEarningsData(result)).toContain('Average Surprise: N/A');
      }
    );

    it('selects current-quarter revisions and nested consensus by period instead of array order', async () => {
      vi.mocked(yahooFinance).quoteSummary.mockResolvedValue({
        earningsTrend: {
          trend: [
            {
              period: '+1q',
              endDate: new Date('2026-09-30'),
              epsTrend: { current: 3, '30daysAgo': 2 },
            },
            { period: '0y', endDate: new Date('2026-12-31'), earningsEstimate: { avg: 4 } },
            {
              period: '0q',
              endDate: new Date('2026-06-30'),
              earningsEstimate: {
                avg: 1,
                low: 0.5,
                high: 1.5,
                yearAgoEps: 0.8,
                numberOfAnalysts: 10,
              },
              epsTrend: { current: 1, '30daysAgo': 2 },
            },
          ],
        },
      } as never);

      const result = await getEarningsData('AAPL');

      expect(result.estimateRevisions).toMatchObject({
        current: 1,
        thirtyDaysAgo: 2,
        direction: 'down',
      });
      expect(result.nextEarningsEstimate).toEqual({
        avg: 1,
        low: 0.5,
        high: 1.5,
        yearAgoEps: 0.8,
        numberOfAnalysts: 10,
      });
      expect(result.currentQuarterEstimate).toBe(1);
      expect(result.currentYearEstimate).toBe(4);
    });

    it('does not borrow next-quarter revisions when current-quarter data is absent', async () => {
      vi.mocked(yahooFinance).quoteSummary.mockResolvedValue({
        earningsTrend: {
          trend: [
            {
              period: '+1q',
              endDate: new Date('2026-09-30'),
              epsTrend: { current: 3, '30daysAgo': 2 },
            },
          ],
        },
      } as never);

      const result = await getEarningsData('AAPL');

      expect(result.estimateRevisions).toBeNull();
      expect(result.currentQuarterEstimate).toBeNull();
      expect(result.nextEarningsEstimate).toBeNull();
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY])(
      'does not classify a non-finite estimate as flat (%s)',
      async (current) => {
        vi.mocked(yahooFinance).quoteSummary.mockResolvedValue({
          earningsTrend: {
            trend: [
              {
                period: '0q',
                endDate: new Date('2026-06-30'),
                epsTrend: { current, '30daysAgo': 1 },
                epsRevisions: { upLast30days: -1, downLast30days: 1.5 },
              },
            ],
          },
        } as never);

        const result = await getEarningsData('AAPL');

        expect(result.estimateRevisions).toEqual({
          up30: null,
          down30: null,
          current: null,
          thirtyDaysAgo: 1,
          direction: null,
        });
      }
    );

    it('keeps negative current-quarter estimates and missing consensus values', async () => {
      vi.mocked(yahooFinance).quoteSummary.mockResolvedValue({
        earningsTrend: {
          trend: [
            {
              period: '0q',
              endDate: new Date('2026-06-30'),
              earningsEstimate: {
                avg: -1,
                low: Number.NaN,
                high: null,
                yearAgoEps: -2,
                numberOfAnalysts: null,
              },
              epsTrend: { current: -1, '30daysAgo': -2 },
            },
          ],
        },
        calendarEvents: { earnings: { earningsDate: [new Date('invalid')] } },
      } as never);

      const result = await getEarningsData('AAPL');

      expect(result.nextEarningsEstimate).toEqual({
        avg: -1,
        low: null,
        high: null,
        yearAgoEps: -2,
        numberOfAnalysts: null,
      });
      expect(result.estimateRevisions?.direction).toBe('up');
      expect(result.nextEarningsDate).toBeNull();
      expect(formatEarningsData({ ...result, nextEarningsDate: new Date('2026-07-20') })).toContain(
        'Range: N/A - N/A'
      );
    });

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
      expect(result.earningsHistory[1]).toMatchObject({
        reportDate: new Date('2023-10-25'),
        epsActual: 1.26,
        epsEstimate: 1.22,
      });
      expect(result.earningsHistory[1].epsDifference).toBeCloseTo(0.04);
      expect(result.earningsHistory[1].surprisePercent).toBeCloseTo(3.28);
      expect(result.earningsTrend).toHaveLength(1);
      expect(result.earningsTrend[0].endDate).toEqual(new Date('2024-03-31'));
      expect(result.currentQuarterEstimate).toBeNull();
      expect(result.currentYearEstimate).toBeNull();
    });

    it('drops history rows without a valid epsActualDate', async () => {
      vi.mocked(yahooFinance).quoteSummary.mockResolvedValue({
        earningsHistory: {
          history: [
            { epsActualDate: '2026-01-28', epsActual: 1.2, epsEstimate: 1.0 },
            // Not-yet-reported quarter: Yahoo omits epsActualDate. new Date(undefined)
            // is an Invalid Date that JSON-serializes to null downstream.
            { epsActual: null, epsEstimate: 1.3 },
            { epsActualDate: 'not-a-date', epsActual: 0.9, epsEstimate: 1.0 },
          ],
        },
        earningsTrend: { trend: [] },
        calendarEvents: {},
        // biome-ignore lint/suspicious/noExplicitAny: Mock data structure complexity
      } as any);

      const result = await getEarningsData('TSLA');

      expect(result.earningsHistory).toHaveLength(1);
      expect(result.earningsHistory[0].reportDate).toEqual(new Date('2026-01-28'));
      expect(Number.isNaN(result.earningsHistory[0].reportDate.getTime())).toBe(false);
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
