import type { AlertRule, AlertTriggerState } from '@stock-checker/core/src/alerts/types';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertEngine } from '@/features/alerts/components/alert-engine';
import { notify } from '@/features/alerts/utils/notify';
import { loadRules, loadState, saveRules, saveState } from '@/features/alerts/utils/storage';
import { getScreener, type TickerResult } from '@/lib/api';

vi.mock('@/lib/api', () => ({ getScreener: vi.fn() }));
vi.mock('@/features/alerts/utils/notify', () => ({ notify: vi.fn() }));

const rule: AlertRule = {
  id: 'aapl-buy',
  ticker: 'AAPL',
  type: 'decision',
  params: { decision: 'BUY' },
  enabled: true,
  createdAt: '2026-10-02T00:00:00.000Z',
};
const results = [{ ticker: 'AAPL', opinion: 'BUY', close: 100 }] as TickerResult[];
const initialState: AlertTriggerState = {
  [rule.id]: { lastValue: false, lastCheckedAt: rule.createdAt },
};

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(getScreener).mockReset();
  vi.mocked(notify).mockReset().mockResolvedValue(undefined);
  saveRules([rule]);
  saveState(initialState);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AlertEngine', () => {
  it('does not notify a rule disabled while the screener request is pending', async () => {
    const request = Promise.withResolvers<TickerResult[]>();
    vi.mocked(getScreener).mockReturnValue(request.promise);
    render(<AlertEngine />);

    saveRules([{ ...rule, enabled: false }]);
    await act(async () => request.resolve(results));

    expect(notify).not.toHaveBeenCalled();
    expect(loadRules()[0].enabled).toBe(false);
    expect(loadState()).toEqual(initialState);
  });

  it('does not restore a deleted rule or its state after the screener request completes', async () => {
    const request = Promise.withResolvers<TickerResult[]>();
    vi.mocked(getScreener).mockReturnValue(request.promise);
    render(<AlertEngine />);

    saveRules([]);
    saveState({});
    await act(async () => request.resolve(results));

    expect(notify).not.toHaveBeenCalled();
    expect(loadRules()).toEqual([]);
    expect(loadState()).toEqual({});
  });

  it('preserves rule additions and edits made while a notification is pending', async () => {
    const notification = Promise.withResolvers<void>();
    vi.mocked(getScreener).mockResolvedValue(results);
    vi.mocked(notify).mockReturnValue(notification.promise);
    await act(async () => render(<AlertEngine />));
    expect(notify).toHaveBeenCalledOnce();

    const added = { ...rule, id: 'tsla-buy', ticker: 'TSLA' };
    saveRules([{ ...rule, enabled: false }, added]);
    await act(async () => notification.resolve());

    expect(loadRules()).toEqual([
      { ...rule, enabled: false, lastTriggeredAt: expect.any(String) },
      added,
    ]);
  });

  it('preserves a rule deletion made while a notification is pending', async () => {
    const notification = Promise.withResolvers<void>();
    vi.mocked(getScreener).mockResolvedValue(results);
    vi.mocked(notify).mockReturnValue(notification.promise);
    await act(async () => render(<AlertEngine />));
    expect(notify).toHaveBeenCalledOnce();

    saveRules([]);
    saveState({});
    await act(async () => notification.resolve());

    expect(loadRules()).toEqual([]);
    expect(loadState()).toEqual({});
  });

  it('does not start another poll while the current one is pending', async () => {
    vi.useFakeTimers();
    const request = Promise.withResolvers<TickerResult[]>();
    vi.mocked(getScreener).mockReturnValue(request.promise);
    const view = render(<AlertEngine />);

    await act(async () => vi.advanceTimersByTime(5 * 60 * 1000));

    expect(getScreener).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => request.resolve(results));
  });

  it('does not notify or persist a poll that finishes after unmount', async () => {
    const request = Promise.withResolvers<TickerResult[]>();
    vi.mocked(getScreener).mockReturnValue(request.promise);
    const view = render(<AlertEngine />);
    view.unmount();

    await act(async () => request.resolve(results));

    expect(notify).not.toHaveBeenCalled();
    expect(loadState()).toEqual(initialState);
  });
});
