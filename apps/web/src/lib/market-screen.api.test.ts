import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIRST_MARKET_JOB,
  fixtureMarketScreenJob,
  fixtureMarketScreenSnapshot,
} from '@/features/market-screen/utils/market-screen-test-fixtures';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('axios', () => ({
  default: { create: () => ({ request, interceptors: { response: { use: vi.fn() } } }) },
}));

import {
  getMarketScreen,
  getMarketScreens,
  pauseMarketScreen,
  resumeMarketScreen,
} from '@/lib/api';

beforeEach(() => request.mockReset());

describe('market-screen HTTP client', () => {
  it('passes bounded list/page parameters and AbortSignal through the shared client', async () => {
    const controller = new AbortController();
    request.mockResolvedValueOnce({
      data: { jobs: [fixtureMarketScreenJob()], offset: 20, limit: 20, total: 21, hasMore: false },
    });
    await getMarketScreens({ offset: 20, signal: controller.signal });
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: '/api/market-screens?offset=20&limit=20',
        signal: controller.signal,
      })
    );
    request.mockResolvedValueOnce({
      data: fixtureMarketScreenSnapshot(FIRST_MARKET_JOB, 'excluded'),
    });
    await getMarketScreen(FIRST_MARKET_JOB, { kind: 'excluded', signal: controller.signal });
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: `/api/market-screens/${FIRST_MARKET_JOB}?kind=excluded&offset=0&limit=20`,
        signal: controller.signal,
      })
    );
  });

  it('sends a JSON object on explicit controls so Fastify does not receive an empty JSON body', async () => {
    request.mockResolvedValue({ data: fixtureMarketScreenSnapshot() });
    await pauseMarketScreen(FIRST_MARKET_JOB);
    await resumeMarketScreen(FIRST_MARKET_JOB);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `/api/market-screens/${FIRST_MARKET_JOB}/pause`,
        method: 'POST',
        data: '{}',
      })
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `/api/market-screens/${FIRST_MARKET_JOB}/resume`,
        method: 'POST',
        data: '{}',
      })
    );
  });

  it('rejects unknown statuses and contradictory progress instead of presenting a valid job', async () => {
    const invalid = fixtureMarketScreenSnapshot();
    Reflect.set(invalid.job, 'status', 'success');
    request.mockResolvedValue({ data: invalid });
    await expect(getMarketScreen(FIRST_MARKET_JOB)).rejects.toMatchObject({
      message: 'Invalid market-screen response; retry to refresh.',
    });
    request.mockResolvedValue({
      data: { jobs: [invalid.job], offset: 0, limit: 20, total: 1, hasMore: false },
    });
    await expect(getMarketScreens()).rejects.toMatchObject({
      message: 'Invalid market-screen job list; retry to refresh.',
    });
    invalid.job.status = 'paused';
    invalid.job.progress.pending = 100;
    request.mockResolvedValue({ data: invalid });
    await expect(getMarketScreen(FIRST_MARKET_JOB)).rejects.toMatchObject({
      message: 'Invalid market-screen response; retry to refresh.',
    });
  });

  it('rejects mismatched jobs, non-finite scores and invented future entry fills', async () => {
    const invalid = fixtureMarketScreenSnapshot();
    request.mockResolvedValue({ data: invalid });
    await expect(getMarketScreen('33333333-3333-4333-8333-333333333333')).rejects.toMatchObject({
      message: 'Invalid market-screen response; retry to refresh.',
    });
    const item = invalid.page.items[0];
    if (!('decision' in item)) throw new Error('Invalid fixture');
    item.buyScore = Number.NaN;
    await expect(getMarketScreen(FIRST_MARKET_JOB)).rejects.toMatchObject({
      message: 'Invalid market-screen response; retry to refresh.',
    });
    item.buyScore = 250;
    Reflect.set(item.execution.entry, 'price', 100);
    await expect(getMarketScreen(FIRST_MARKET_JOB)).rejects.toMatchObject({
      message: 'Invalid market-screen response; retry to refresh.',
    });
  });
});
