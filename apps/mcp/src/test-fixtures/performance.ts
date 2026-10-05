import type { MarketScreenPerformanceSnapshot } from '@stock-checker/core/src/reports/market-screen.ts';

export const PERFORMANCE_FIXTURE_JOB_ID = 'bd6128e1-d410-4a61-a90e-dfbd6a86167e';

export function fixturePerformance(): MarketScreenPerformanceSnapshot {
  return {
    jobId: PERFORMANCE_FIXTURE_JOB_ID,
    policy: {
      id: 'us-buy-next-open-five-session-v1',
      mode: 'forward-paper',
      timezone: 'America/New_York',
      entry: 'next-session-open',
      exit: 'fifth-session-close',
      horizonSessions: 5,
      costBpsRoundTrip: 10,
      adjustment: 'same-fetched-adjusted-series',
    },
    updatedAt: '2026-10-13T21:00:00.000Z',
    summary: {
      totalRecommendations: 4,
      completed: 1,
      wins: 1,
      losses: 0,
      breakeven: 0,
      pending: 1,
      open: 1,
      unavailable: 1,
      ineligible: 0,
      legacyUntracked: 0,
      winRatePct: 100,
      averageNetReturnPct: 1.9,
    },
    page: {
      offset: 0,
      limit: 20,
      total: 4,
      hasMore: false,
      items: [
        {
          recommendationId: 'fixture-aapl-recommendation',
          ticker: 'AAPL',
          dataAsOf: '2026-10-02',
          recommendedAt: '2026-10-05T13:00:00.000Z',
          status: 'completed',
          reason: null,
          entryDate: '2026-10-05',
          exitDate: '2026-10-09',
          entryPrice: 100,
          exitPrice: 102,
          grossReturnPct: 2,
          netReturnPct: 1.9,
          outcome: 'win',
          updatedAt: '2026-10-13T21:00:00.000Z',
        },
        ...(['pending', 'open', 'unavailable'] as const).map((status, index) => ({
          recommendationId: `fixture-${status}-recommendation`,
          ticker: ['MSFT', 'NVDA', 'OII'][index] ?? 'OII',
          dataAsOf: '2026-10-09',
          recommendedAt: '2026-10-12T13:00:00.000Z',
          status,
          reason:
            status === 'unavailable' ? 'Usable completed-session prices are unavailable.' : null,
          entryDate: status === 'open' ? '2026-10-12' : null,
          exitDate: null,
          entryPrice: status === 'open' ? 100 : null,
          exitPrice: null,
          grossReturnPct: null,
          netReturnPct: null,
          outcome: null,
          updatedAt: '2026-10-13T21:00:00.000Z',
        })),
      ],
    },
    refresh: { status: 'idle', selected: 0, processed: 0, reason: null },
  };
}
