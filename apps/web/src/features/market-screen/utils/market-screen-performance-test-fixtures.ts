import { FIRST_MARKET_JOB } from '@/features/market-screen/utils/market-screen-test-fixtures';
import type { MarketScreenPerformanceRow, MarketScreenPerformanceSnapshot } from '@/lib/api';

export function fixturePaperRow(
  status: MarketScreenPerformanceRow['status'] = 'pending',
  ticker = 'PAPER'
): MarketScreenPerformanceRow {
  return {
    recommendationId: `saved-${ticker}`,
    ticker,
    dataAsOf: '2026-09-25',
    recommendedAt: status === 'legacy-untracked' ? null : '2026-09-26T01:00:00.000Z',
    status,
    reason:
      status === 'unavailable' ? 'Market data is unavailable; outcome remains unknown.' : null,
    entryDate: status === 'completed' || status === 'open' ? '2026-09-28' : null,
    exitDate: status === 'completed' ? '2026-10-02' : null,
    entryPrice: status === 'completed' || status === 'open' ? 100 : null,
    exitPrice: status === 'completed' ? 101.1 : null,
    grossReturnPct: status === 'completed' ? 1.1 : null,
    netReturnPct: status === 'completed' ? 1 : null,
    outcome: status === 'completed' ? 'win' : null,
    updatedAt: '2026-10-03T00:00:00.000Z',
  };
}

export function fixturePaperSnapshot(jobId = FIRST_MARKET_JOB): MarketScreenPerformanceSnapshot {
  return {
    jobId,
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
    updatedAt: null,
    summary: {
      totalRecommendations: 1,
      completed: 0,
      wins: 0,
      losses: 0,
      breakeven: 0,
      pending: 1,
      open: 0,
      unavailable: 0,
      ineligible: 0,
      legacyUntracked: 0,
      winRatePct: null,
      averageNetReturnPct: null,
    },
    page: { offset: 0, limit: 20, total: 1, hasMore: false, items: [fixturePaperRow()] },
    refresh: { status: 'idle', selected: 0, processed: 0, reason: null },
  };
}

export function fixtureCompletedPaperSnapshot(): MarketScreenPerformanceSnapshot {
  const snapshot = fixturePaperSnapshot();
  const win = fixturePaperRow('completed', 'WINNER');
  const loss = {
    ...fixturePaperRow('completed', 'LOSER'),
    exitPrice: 99.1,
    grossReturnPct: -0.9,
    netReturnPct: -1,
    outcome: 'loss' as const,
  };
  const breakeven = {
    ...fixturePaperRow('completed', 'EVEN'),
    exitPrice: 100.1,
    grossReturnPct: 0.1,
    netReturnPct: 0,
    outcome: 'breakeven' as const,
  };
  snapshot.updatedAt = '2026-10-03T00:00:00.000Z';
  snapshot.summary = {
    totalRecommendations: 8,
    completed: 3,
    wins: 1,
    losses: 1,
    breakeven: 1,
    pending: 1,
    open: 1,
    unavailable: 1,
    ineligible: 1,
    legacyUntracked: 1,
    winRatePct: 100 / 3,
    averageNetReturnPct: 0,
  };
  snapshot.page = {
    offset: 0,
    limit: 20,
    total: 8,
    hasMore: false,
    items: [
      win,
      loss,
      breakeven,
      fixturePaperRow(),
      fixturePaperRow('open', 'OPEN'),
      fixturePaperRow('unavailable', 'UNKNOWN'),
      fixturePaperRow('ineligible', 'INELIGIBLE'),
      fixturePaperRow('legacy-untracked', 'LEGACY'),
    ],
  };
  return snapshot;
}
