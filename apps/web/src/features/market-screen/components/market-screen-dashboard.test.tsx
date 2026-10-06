import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketScreenDashboard } from '@/features/market-screen/components/market-screen-dashboard';
import { fixturePaperSnapshot } from '@/features/market-screen/utils/market-screen-performance-test-fixtures';
import {
  FIRST_MARKET_JOB,
  fixtureMarketScreenJob,
  fixtureMarketScreenSnapshot,
} from '@/features/market-screen/utils/market-screen-test-fixtures';
import {
  getMarketScreen,
  getMarketScreenPerformance,
  getMarketScreens,
  type MarketScreenJobSnapshot,
  pauseMarketScreen,
  resumeMarketScreen,
} from '@/lib/api';

vi.mock('@/lib/api', () => ({
  getMarketScreen: vi.fn(),
  getMarketScreenPerformance: vi.fn(),
  refreshMarketScreenPerformance: vi.fn(),
  getMarketScreens: vi.fn(),
  pauseMarketScreen: vi.fn(),
  resumeMarketScreen: vi.fn(),
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    prefetch,
    children,
    ...props
  }: {
    href: string;
    prefetch?: boolean;
    children: ReactNode;
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.mocked(getMarketScreenPerformance).mockReset().mockResolvedValue(fixturePaperSnapshot());
  vi.mocked(getMarketScreens)
    .mockReset()
    .mockResolvedValue({
      jobs: [fixtureMarketScreenJob()],
      offset: 0,
      limit: 20,
      total: 1,
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

describe('saved market-screen dashboard', () => {
  it('renders source coverage and saved session evidence without implying scores are observed win rates', async () => {
    render(<MarketScreenDashboard />);
    await screen.findByText('REFERENCE CLOSE (USD)');
    expect(await screen.findByRole('link', { name: 'AA — Live ticker detail' })).toHaveAttribute(
      'href',
      '/AA'
    );
    expect(screen.getByRole('link', { name: 'AA — Live ticker detail' })).toHaveAttribute(
      'data-prefetch',
      'false'
    );
    expect(screen.getByText('2 / 3 FILTERED CANDIDATES COLLECTED')).toBeInTheDocument();
    expect(screen.getByText('Price below SMA50')).toBeInTheDocument();
    expect(screen.getByText('2026-10-02')).toBeInTheDocument();
    expect(screen.getByText(/not win or stop-loss probabilities/)).toBeInTheDocument();
    expect(screen.getByText(/Future next-session entry prices are unknown/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open saved Finviz source filters' })).toHaveAttribute(
      'href',
      fixtureMarketScreenJob().universe.url
    );
    expect(resumeMarketScreen).not.toHaveBeenCalled();
  });

  it('runs a mutation only after explicit Resume and updates status afterwards', async () => {
    const user = userEvent.setup();
    render(<MarketScreenDashboard />);
    await screen.findByRole('button', { name: 'Resume' });
    expect(resumeMarketScreen).not.toHaveBeenCalled();
    vi.mocked(getMarketScreen).mockImplementation(async (id, options) =>
      fixtureMarketScreenSnapshot(id, options?.kind, 'running')
    );
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(resumeMarketScreen).toHaveBeenCalledWith(FIRST_MARKET_JOB, expect.any(AbortSignal));
    expect(await screen.findByText('RUNNING')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
  });

  it.each([
    { ticker: 'MISSING', reason: 'Completed-session data unavailable.' },
    {
      ticker: 'NIVF',
      reason: '평균 가격 변동폭 기준으로 유효한 손절·목표가를 산정할 수 없습니다.',
    },
  ])(
    'hides prior rows and preserves unavailable analysis reasons separately from HOLD ($ticker)',
    async ({ ticker, reason }) => {
      const user = userEvent.setup();
      const pending = Promise.withResolvers<MarketScreenJobSnapshot>();
      render(<MarketScreenDashboard />);
      await screen.findByRole('link', { name: 'AA — Live ticker detail' });
      vi.mocked(getMarketScreen).mockReturnValueOnce(pending.promise);
      await user.click(screen.getByRole('tab', { name: 'UNAVAILABLE' }));
      expect(
        screen.queryByRole('link', { name: 'AA — Live ticker detail' })
      ).not.toBeInTheDocument();
      const unavailable = fixtureMarketScreenSnapshot(FIRST_MARKET_JOB, 'unavailable');
      unavailable.page.items = [{ ticker, reason, attempts: 1 }];
      await act(async () => pending.resolve(unavailable));
      expect(await screen.findByText(ticker)).toBeInTheDocument();
      expect(screen.getByText(reason)).toBeInTheDocument();
      expect(
        screen.getByText(/Analysis unavailable; no HOLD decision was produced\./)
      ).toBeInTheDocument();
      expect(screen.queryByText(/This is unavailable data/)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('table', { name: 'Saved market-screen decisions' })
      ).not.toBeInTheDocument();
    }
  );

  it('uses bounded result pagination and hides the preceding page while awaiting the next one', async () => {
    const user = userEvent.setup();
    const first = fixtureMarketScreenSnapshot();
    first.page.total = 25;
    first.page.hasMore = true;
    vi.mocked(getMarketScreen).mockResolvedValueOnce(first);
    render(<MarketScreenDashboard />);
    await screen.findByRole('link', { name: 'AA — Live ticker detail' });
    const pending = Promise.withResolvers<MarketScreenJobSnapshot>();
    vi.mocked(getMarketScreen).mockReturnValueOnce(pending.promise);
    await user.click(screen.getByRole('button', { name: 'Next results' }));
    expect(getMarketScreen).toHaveBeenLastCalledWith(
      FIRST_MARKET_JOB,
      expect.objectContaining({ kind: 'matches', offset: 20, limit: 20 })
    );
    expect(screen.queryByRole('link', { name: 'AA — Live ticker detail' })).not.toBeInTheDocument();
    const second = fixtureMarketScreenSnapshot();
    second.page.offset = 20;
    second.page.total = 25;
    second.page.items[0].ticker = 'ZZZ';
    await act(async () => pending.resolve(second));
    expect(
      await screen.findByRole('link', { name: 'ZZZ — Live ticker detail' })
    ).toBeInTheDocument();
  });

  it('marks retained data stale after failed reads and disables controls until a retry succeeds', async () => {
    const user = userEvent.setup();
    render(<MarketScreenDashboard />);
    await screen.findByRole('link', { name: 'AA — Live ticker detail' });
    vi.mocked(getMarketScreen).mockRejectedValueOnce(new Error('API error 503: Unavailable'));
    await user.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByText('Job status refresh failed')).toBeInTheDocument();
    expect(screen.getByText(/Status may be stale/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
    await user.click(
      within(screen.getByRole('alert')).getByRole('button', { name: 'Retry refresh' })
    );
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeEnabled();
    expect(resumeMarketScreen).not.toHaveBeenCalled();
  });

  it('labels matching counts by the requested decision instead of treating SELL matches as BUY candidates', async () => {
    const saved = fixtureMarketScreenSnapshot();
    saved.job.criteria.decision = 'SELL';
    vi.mocked(getMarketScreen).mockResolvedValue(saved);
    render(<MarketScreenDashboard />);
    expect(await screen.findByText('SELL MATCHES')).toBeInTheDocument();
    expect(screen.queryByText('BUY MATCHES')).not.toBeInTheDocument();
  });
});
