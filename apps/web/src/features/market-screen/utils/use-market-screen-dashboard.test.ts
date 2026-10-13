import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIRST_MARKET_JOB,
  fixtureMarketScreenJob,
  fixtureMarketScreenSnapshot,
  SECOND_MARKET_JOB,
} from '@/features/market-screen/utils/market-screen-test-fixtures';
import {
  MARKET_SCREEN_POLL_MS,
  useMarketScreenDashboard,
} from '@/features/market-screen/utils/use-market-screen-dashboard';
import {
  getMarketScreen,
  getMarketScreens,
  type MarketScreenJobSnapshot,
  pauseMarketScreen,
  resumeMarketScreen,
} from '@/lib/api';

vi.mock('@/lib/api', () => ({
  getMarketScreen: vi.fn(),
  getMarketScreens: vi.fn(),
  pauseMarketScreen: vi.fn(),
  resumeMarketScreen: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(getMarketScreens)
    .mockReset()
    .mockResolvedValue({
      jobs: [fixtureMarketScreenJob(), fixtureMarketScreenJob(SECOND_MARKET_JOB)],
      offset: 0,
      limit: 20,
      total: 2,
      hasMore: false,
    });
  vi.mocked(getMarketScreen)
    .mockReset()
    .mockImplementation(async (id, options) => fixtureMarketScreenSnapshot(id, options?.kind));
  vi.mocked(pauseMarketScreen).mockReset().mockResolvedValue(fixtureMarketScreenSnapshot());
  vi.mocked(resumeMarketScreen)
    .mockReset()
    .mockResolvedValue(fixtureMarketScreenSnapshot(FIRST_MARKET_JOB, 'matches', 'running'));
});
afterEach(() => vi.useRealTimers());

describe('market-screen reads and explicit controls', () => {
  it('selects saved jobs automatically without starting any analysis', async () => {
    const view = renderHook(() => useMarketScreenDashboard());
    await act(async () => {});
    expect(view.result.current.selectedId).toBe(FIRST_MARKET_JOB);
    expect(view.result.current.snapshot?.job.id).toBe(FIRST_MARKET_JOB);
    expect(resumeMarketScreen).not.toHaveBeenCalled();
    expect(pauseMarketScreen).not.toHaveBeenCalled();
  });

  it('does not overlap polls and aborts a pending read on unmount', async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<MarketScreenJobSnapshot>();
    vi.mocked(getMarketScreen).mockReturnValue(pending.promise);
    const view = renderHook(() => useMarketScreenDashboard());
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(MARKET_SCREEN_POLL_MS * 3));
    expect(getMarketScreen).toHaveBeenCalledTimes(1);
    const signal = vi.mocked(getMarketScreen).mock.calls[0][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(fixtureMarketScreenSnapshot()));
    await act(async () => vi.advanceTimersByTime(MARKET_SCREEN_POLL_MS * 3));
    expect(getMarketScreen).toHaveBeenCalledTimes(1);
  });

  it('rejects a late response from the previously selected job even if the transport ignores abort', async () => {
    const first = Promise.withResolvers<MarketScreenJobSnapshot>();
    const second = Promise.withResolvers<MarketScreenJobSnapshot>();
    vi.mocked(getMarketScreen).mockImplementation((id) =>
      id === FIRST_MARKET_JOB ? first.promise : second.promise
    );
    const view = renderHook(() => useMarketScreenDashboard());
    await act(async () => {});
    await act(async () => view.result.current.selectJob(SECOND_MARKET_JOB));
    await act(async () => second.resolve(fixtureMarketScreenSnapshot(SECOND_MARKET_JOB)));
    await act(async () => first.resolve(fixtureMarketScreenSnapshot()));
    expect(view.result.current.snapshot?.job.id).toBe(SECOND_MARKET_JOB);
    expect(vi.mocked(getMarketScreen).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('prevents an older GET from reverting a successful explicit resume', async () => {
    const oldRead = Promise.withResolvers<MarketScreenJobSnapshot>();
    const newRead = Promise.withResolvers<MarketScreenJobSnapshot>();
    vi.mocked(getMarketScreen)
      .mockResolvedValueOnce(fixtureMarketScreenSnapshot())
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(newRead.promise);
    const view = renderHook(() => useMarketScreenDashboard());
    await act(async () => {});
    await act(async () => view.result.current.retryJob());
    await act(async () => view.result.current.control('resume'));
    await act(async () => oldRead.resolve(fixtureMarketScreenSnapshot()));
    expect(view.result.current.snapshot?.job.status).toBe('running');
    expect(vi.mocked(getMarketScreen).mock.calls[1][1]?.signal?.aborted).toBe(true);
    expect(resumeMarketScreen).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => newRead.resolve(fixtureMarketScreenSnapshot()));
  });

  it('selects a deep-linked job immediately and keeps it when the list arrives', async () => {
    const view = renderHook(() => useMarketScreenDashboard({ initialJobId: SECOND_MARKET_JOB }));
    expect(view.result.current.selectedId).toBe(SECOND_MARKET_JOB);
    await act(async () => {});
    expect(view.result.current.selectedId).toBe(SECOND_MARKET_JOB);
    expect(view.result.current.snapshot?.job.id).toBe(SECOND_MARKET_JOB);
    expect(vi.mocked(getMarketScreen).mock.calls[0][0]).toBe(SECOND_MARKET_JOB);
    expect(new URL(window.location.href).searchParams.get('job')).toBe(SECOND_MARKET_JOB);
    expect(resumeMarketScreen).not.toHaveBeenCalled();
  });

  it('switches once to the near-miss view when a settled job has no matches', async () => {
    vi.mocked(getMarketScreen).mockImplementation(async (id, options) => {
      const snapshot = fixtureMarketScreenSnapshot(id, options?.kind, 'completed');
      snapshot.job.progress.matched = 0;
      snapshot.job.progress.excluded = 2;
      if (options?.kind === 'matches') {
        snapshot.page.items = [];
        snapshot.page.total = 0;
      }
      return snapshot;
    });
    const view = renderHook(() => useMarketScreenDashboard());
    await act(async () => {});
    expect(view.result.current.kind).toBe('excluded');
    expect(view.result.current.nearMissView).toBe(true);
    expect(vi.mocked(getMarketScreen).mock.calls.map((call) => call[1]?.kind)).toEqual([
      'matches',
      'excluded',
    ]);
    await act(async () => view.result.current.selectKind('matches'));
    expect(view.result.current.kind).toBe('matches');
    expect(view.result.current.nearMissView).toBe(false);
  });

  it('keeps the matches tab when matches exist or analysis is still pending', async () => {
    const view = renderHook(() => useMarketScreenDashboard());
    await act(async () => {});
    expect(view.result.current.kind).toBe('matches');
    expect(view.result.current.nearMissView).toBe(false);
  });

  it('stops terminal polling while continuing read-only paused status polling', async () => {
    vi.useFakeTimers();
    vi.mocked(getMarketScreen).mockResolvedValue(
      fixtureMarketScreenSnapshot(FIRST_MARKET_JOB, 'matches', 'partial')
    );
    const view = renderHook(() => useMarketScreenDashboard());
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(MARKET_SCREEN_POLL_MS * 2));
    expect(getMarketScreen).toHaveBeenCalledTimes(1);
    await act(async () => view.result.current.selectJob(SECOND_MARKET_JOB));
    vi.mocked(getMarketScreen).mockResolvedValue(fixtureMarketScreenSnapshot(SECOND_MARKET_JOB));
    await act(async () => view.result.current.retryJob());
    const before = vi.mocked(getMarketScreen).mock.calls.length;
    await act(async () => vi.advanceTimersByTime(MARKET_SCREEN_POLL_MS));
    expect(getMarketScreen).toHaveBeenCalledTimes(before + 1);
    expect(resumeMarketScreen).not.toHaveBeenCalled();
  });
});
