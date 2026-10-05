import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fixtureCompletedPaperSnapshot,
  fixturePaperSnapshot,
} from '@/features/market-screen/utils/market-screen-performance-test-fixtures';
import {
  FIRST_MARKET_JOB,
  SECOND_MARKET_JOB,
} from '@/features/market-screen/utils/market-screen-test-fixtures';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('axios', () => ({
  default: { create: () => ({ request, interceptors: { response: { use: vi.fn() } } }) },
}));

import { getMarketScreenPerformance, refreshMarketScreenPerformance } from '@/lib/api';

beforeEach(() => request.mockReset());
const invalidResponse = { message: 'Invalid paper-performance response; retry saved outcomes.' };

describe('paper-performance HTTP client', () => {
  it('uses cache-only GET with pagination and cancellation and explicit bounded JSON POST', async () => {
    const controller = new AbortController();
    const snapshot = fixturePaperSnapshot();
    snapshot.page.offset = 20;
    snapshot.page.items = [];
    request.mockResolvedValueOnce({ data: snapshot });
    await getMarketScreenPerformance(FIRST_MARKET_JOB, { offset: 20, signal: controller.signal });
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: `/api/market-screens/${FIRST_MARKET_JOB}/performance?offset=20&limit=20`,
        signal: controller.signal,
      })
    );
    request.mockResolvedValueOnce({ data: fixturePaperSnapshot() });
    await refreshMarketScreenPerformance(FIRST_MARKET_JOB, {
      limit: 50,
      signal: controller.signal,
    });
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: `/api/market-screens/${FIRST_MARKET_JOB}/performance/refresh`,
        method: 'POST',
        data: '{"limit":50}',
        signal: controller.signal,
      })
    );
  });

  it('keeps missing samples null and accepts zero observed net return with completed breakeven samples', async () => {
    request.mockResolvedValueOnce({ data: fixturePaperSnapshot() });
    expect((await getMarketScreenPerformance(FIRST_MARKET_JOB)).summary.winRatePct).toBeNull();
    request.mockResolvedValueOnce({ data: fixtureCompletedPaperSnapshot() });
    const result = await getMarketScreenPerformance(FIRST_MARKET_JOB);
    expect(result.summary.winRatePct).toBeCloseTo(100 / 3);
    expect(result.summary.averageNetReturnPct).toBe(0);
    expect(result.page.items[2].outcome).toBe('breakeven');
  });

  it.each([{ offset: -1 }, { offset: Number.NaN }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }])(
    'rejects invalid read page options before making a request: %j',
    async (options) => {
      await expect(getMarketScreenPerformance(FIRST_MARKET_JOB, options)).rejects.toMatchObject({
        message: 'Invalid paper-performance page or refresh limit.',
      });
      expect(request).not.toHaveBeenCalled();
    }
  );

  it('rejects refresh limits over 50 without calling providers', async () => {
    await expect(
      refreshMarketScreenPerformance(FIRST_MARKET_JOB, { limit: 51 })
    ).rejects.toMatchObject({
      message: 'Invalid paper-performance page or refresh limit.',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    (s: ReturnType<typeof fixturePaperSnapshot>) => {
      s.jobId = SECOND_MARKET_JOB;
    },
    (s: ReturnType<typeof fixturePaperSnapshot>) => {
      s.page.offset = 20;
    },
    (s: ReturnType<typeof fixturePaperSnapshot>) => {
      Reflect.set(s.page.items[0], 'status', 'success');
    },
    (s: ReturnType<typeof fixturePaperSnapshot>) => {
      Reflect.set(s.policy, 'costBpsRoundTrip', 20);
    },
    (s: ReturnType<typeof fixturePaperSnapshot>) => {
      s.summary.winRatePct = 0;
    },
    (s: ReturnType<typeof fixturePaperSnapshot>) => {
      s.summary.totalRecommendations = 2;
    },
    (s: ReturnType<typeof fixturePaperSnapshot>) => {
      s.page.items[0].netReturnPct = Number.NaN;
    },
    (s: ReturnType<typeof fixturePaperSnapshot>) => {
      s.page.items[0].entryDate = '2026-02-30';
    },
    (s: ReturnType<typeof fixturePaperSnapshot>) => {
      s.refresh.processed = 1;
    },
  ])('rejects an invalid or financially contradictory saved response %#', async (mutate) => {
    const snapshot = fixturePaperSnapshot();
    mutate(snapshot);
    request.mockResolvedValue({ data: snapshot });
    await expect(getMarketScreenPerformance(FIRST_MARKET_JOB)).rejects.toMatchObject(
      invalidResponse
    );
  });

  it('rejects inflated win rates and missing completed outcomes rather than presenting them as verified wins', async () => {
    const snapshot = fixtureCompletedPaperSnapshot();
    snapshot.summary.winRatePct = 100;
    request.mockResolvedValue({ data: snapshot });
    await expect(getMarketScreenPerformance(FIRST_MARKET_JOB)).rejects.toMatchObject(
      invalidResponse
    );
    snapshot.summary.winRatePct = 100 / 3;
    snapshot.page.items[0].outcome = null;
    await expect(getMarketScreenPerformance(FIRST_MARKET_JOB)).rejects.toMatchObject(
      invalidResponse
    );
  });
});
