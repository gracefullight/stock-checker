import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixturePaperSnapshot } from '@/features/market-screen/utils/market-screen-performance-test-fixtures';
import {
  FIRST_MARKET_JOB,
  SECOND_MARKET_JOB,
} from '@/features/market-screen/utils/market-screen-test-fixtures';
import {
  PAPER_OUTCOMES_POLL_MS,
  useMarketScreenPerformance,
} from '@/features/market-screen/utils/use-market-screen-performance';
import {
  getMarketScreenPerformance,
  type MarketScreenPerformanceSnapshot,
  refreshMarketScreenPerformance,
} from '@/lib/api';

vi.mock('@/lib/api', () => ({
  getMarketScreenPerformance: vi.fn(),
  refreshMarketScreenPerformance: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(getMarketScreenPerformance)
    .mockReset()
    .mockImplementation(async (jobId, options) => {
      const snapshot = fixturePaperSnapshot(jobId);
      snapshot.page.offset = options?.offset ?? 0;
      return snapshot;
    });
  vi.mocked(refreshMarketScreenPerformance).mockReset().mockResolvedValue(fixturePaperSnapshot());
});
afterEach(() => vi.useRealTimers());

describe('paper outcome reads and explicit refresh', () => {
  it('only reads cached data on mount and polling, including background refresh progress', async () => {
    vi.useFakeTimers();
    const running = fixturePaperSnapshot();
    running.refresh = { status: 'running', selected: 20, processed: 2, reason: null };
    vi.mocked(getMarketScreenPerformance).mockResolvedValue(running);
    const view = renderHook(() => useMarketScreenPerformance(FIRST_MARKET_JOB));
    await act(async () => {});
    expect(view.result.current.snapshot?.refresh.processed).toBe(2);
    await act(async () => vi.advanceTimersByTime(PAPER_OUTCOMES_POLL_MS));
    expect(getMarketScreenPerformance).toHaveBeenCalledTimes(2);
    expect(refreshMarketScreenPerformance).not.toHaveBeenCalled();
    await act(async () => view.result.current.refresh());
    expect(refreshMarketScreenPerformance).not.toHaveBeenCalled();
  });

  it('does not overlap GET polls and aborts outstanding work on unmount', async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<MarketScreenPerformanceSnapshot>();
    vi.mocked(getMarketScreenPerformance).mockReturnValue(pending.promise);
    const view = renderHook(() => useMarketScreenPerformance(FIRST_MARKET_JOB));
    await act(async () => vi.advanceTimersByTime(PAPER_OUTCOMES_POLL_MS * 3));
    expect(getMarketScreenPerformance).toHaveBeenCalledTimes(1);
    const signal = vi.mocked(getMarketScreenPerformance).mock.calls[0][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(fixturePaperSnapshot()));
    await act(async () => vi.advanceTimersByTime(PAPER_OUTCOMES_POLL_MS * 3));
    expect(getMarketScreenPerformance).toHaveBeenCalledTimes(1);
    expect(refreshMarketScreenPerformance).not.toHaveBeenCalled();
  });

  it('ignores a late old-job read even when the transport ignores AbortSignal', async () => {
    const old = Promise.withResolvers<MarketScreenPerformanceSnapshot>();
    vi.mocked(getMarketScreenPerformance).mockReturnValueOnce(old.promise);
    const view = renderHook(({ id }) => useMarketScreenPerformance(id), {
      initialProps: { id: FIRST_MARKET_JOB },
    });
    view.rerender({ id: SECOND_MARKET_JOB });
    await act(async () => {});
    expect(view.result.current.snapshot?.jobId).toBe(SECOND_MARKET_JOB);
    await act(async () => old.resolve(fixturePaperSnapshot()));
    expect(view.result.current.snapshot?.jobId).toBe(SECOND_MARKET_JOB);
    expect(vi.mocked(getMarketScreenPerformance).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('aborts a preceding GET and keeps the POST background progress instead of late stale progress', async () => {
    const oldRead = Promise.withResolvers<MarketScreenPerformanceSnapshot>();
    const afterRefresh = Promise.withResolvers<MarketScreenPerformanceSnapshot>();
    vi.mocked(getMarketScreenPerformance)
      .mockResolvedValueOnce(fixturePaperSnapshot())
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(afterRefresh.promise);
    const running = fixturePaperSnapshot();
    running.refresh = { status: 'running', selected: 1, processed: 0, reason: null };
    vi.mocked(refreshMarketScreenPerformance).mockResolvedValue(running);
    const view = renderHook(() => useMarketScreenPerformance(FIRST_MARKET_JOB));
    await act(async () => {});
    await act(async () => view.result.current.retryRead());
    await act(async () => view.result.current.refresh());
    await act(async () => oldRead.resolve(fixturePaperSnapshot()));
    expect(view.result.current.snapshot?.refresh.status).toBe('running');
    expect(vi.mocked(getMarketScreenPerformance).mock.calls[1][1]?.signal?.aborted).toBe(true);
    expect(refreshMarketScreenPerformance).toHaveBeenCalledWith(
      FIRST_MARKET_JOB,
      expect.objectContaining({ limit: 20, signal: expect.any(AbortSignal) })
    );
    await act(async () => view.result.current.refresh());
    expect(refreshMarketScreenPerformance).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => afterRefresh.resolve(fixturePaperSnapshot()));
  });

  it('prevents duplicate explicit refreshes and ignores completion after changing jobs', async () => {
    const pending = Promise.withResolvers<MarketScreenPerformanceSnapshot>();
    vi.mocked(refreshMarketScreenPerformance).mockReturnValueOnce(pending.promise);
    const view = renderHook(({ id }) => useMarketScreenPerformance(id), {
      initialProps: { id: FIRST_MARKET_JOB },
    });
    await act(async () => {});
    let refreshing: Promise<void> | undefined;
    act(() => {
      refreshing = view.result.current.refresh();
    });
    expect(view.result.current.refreshing).toBe(true);
    await act(async () => view.result.current.refresh());
    expect(refreshMarketScreenPerformance).toHaveBeenCalledTimes(1);
    view.rerender({ id: SECOND_MARKET_JOB });
    await act(async () => {});
    expect(vi.mocked(refreshMarketScreenPerformance).mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve(fixturePaperSnapshot());
      await refreshing;
    });
    expect(view.result.current.snapshot?.jobId).toBe(SECOND_MARKET_JOB);
    expect(view.result.current.refreshError).toBeNull();
    expect(view.result.current.refreshing).toBe(false);
  });

  it('retains last saved evidence on failed reads and refreshes, and retries GET after a failed POST', async () => {
    const view = renderHook(() => useMarketScreenPerformance(FIRST_MARKET_JOB));
    await act(async () => {});
    vi.mocked(getMarketScreenPerformance).mockRejectedValueOnce(new Error('API unavailable'));
    await act(async () => view.result.current.retryRead());
    expect(view.result.current.readError).toBe('API unavailable');
    expect(view.result.current.snapshot?.summary.winRatePct).toBeNull();
    await act(async () => view.result.current.retryRead());
    expect(view.result.current.readError).toBeNull();
    vi.mocked(refreshMarketScreenPerformance).mockRejectedValueOnce(
      new Error('Refresh request failed')
    );
    const before = vi.mocked(getMarketScreenPerformance).mock.calls.length;
    await act(async () => view.result.current.refresh());
    expect(view.result.current.refreshError).toBe('Refresh request failed');
    expect(getMarketScreenPerformance).toHaveBeenCalledTimes(before + 1);
    expect(view.result.current.snapshot?.summary.winRatePct).toBeNull();
  });
});
