import { beforeEach, describe, expect, it, vi } from 'vitest';
import { predict } from '@/commands/predict';
import {
  addAsset,
  generatePerformanceReport,
  getPortfolio,
  removeAsset,
} from '@/portfolio/manager';
import { getFearGreedIndex } from '@/services/data-fetcher';

vi.mock('@/portfolio/manager', () => ({
  addAsset: vi.fn(),
  generatePerformanceReport: vi.fn(),
  getPortfolio: vi.fn(),
  removeAsset: vi.fn(),
}));

vi.mock('@/services/data-fetcher', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/data-fetcher')>()),
  getFearGreedIndex: vi.fn(),
}));

describe('predict portfolio actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getPortfolio).mockResolvedValue({ assets: ['TSLA'], createdAt: '2026-01-01' });
  });

  it.each([
    { action: 'add', operation: addAsset },
    { action: 'remove', operation: removeAsset },
    { action: 'list', operation: getPortfolio },
  ] as const)('runs $action without fetching market sentiment', async ({ action, operation }) => {
    vi.mocked(getFearGreedIndex).mockRejectedValue(new Error('Market data unavailable'));

    await expect(
      predict({
        tickers: [],
        sort: 'asc',
        format: 'csv',
        portfolioAction: action,
        portfolioTicker: 'TSLA',
      })
    ).resolves.toBeUndefined();

    expect(operation).toHaveBeenCalledOnce();
    expect(getFearGreedIndex).not.toHaveBeenCalled();
  });

  it('still fetches sentiment for portfolio report analysis', async () => {
    vi.mocked(getFearGreedIndex).mockResolvedValue(50);

    await predict({ tickers: [], sort: 'asc', format: 'csv', portfolioAction: 'report' });

    expect(getFearGreedIndex).toHaveBeenCalledOnce();
    expect(generatePerformanceReport).toHaveBeenCalledWith([], []);
  });
});
