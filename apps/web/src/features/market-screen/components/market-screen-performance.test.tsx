import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketScreenPerformance } from '@/features/market-screen/components/market-screen-performance';
import {
  fixtureCompletedPaperSnapshot,
  fixturePaperSnapshot,
} from '@/features/market-screen/utils/market-screen-performance-test-fixtures';
import { FIRST_MARKET_JOB } from '@/features/market-screen/utils/market-screen-test-fixtures';
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
  vi.mocked(getMarketScreenPerformance).mockReset().mockResolvedValue(fixturePaperSnapshot());
  vi.mocked(refreshMarketScreenPerformance).mockReset().mockResolvedValue(fixturePaperSnapshot());
});

const valueFor = (label: string) => screen.getByText(label).nextElementSibling;

describe('forward paper outcomes', () => {
  it('shows unknown win rate without completed samples and states the actual paper policy', async () => {
    render(<MarketScreenPerformance jobId={FIRST_MARKET_JOB} />);
    await screen.findByRole('table', { name: 'Forward paper outcome records' });
    expect(valueFor('Completed-sample win rate')).toHaveTextContent('—');
    expect(valueFor('Mean completed net return')).toHaveTextContent('—');
    expect(screen.getByText(/No verified forward win rate/)).toBeInTheDocument();
    expect(screen.getByText(/not broker executions/)).toHaveTextContent(
      'next trading session open'
    );
    expect(screen.getByText(/not broker executions/)).toHaveTextContent('fifth session close');
    expect(screen.getByText(/not broker executions/)).toHaveTextContent('10 bps (0.10%)');
    expect(screen.getByText(/Reads and automatic polling/)).toBeInTheDocument();
    expect(refreshMarketScreenPerformance).not.toHaveBeenCalled();
  });

  it('uses completed observations and preserves breakeven zero while separating unavailable and legacy records', async () => {
    vi.mocked(getMarketScreenPerformance).mockResolvedValue(fixtureCompletedPaperSnapshot());
    render(<MarketScreenPerformance jobId={FIRST_MARKET_JOB} />);
    await screen.findByText('WINNER');
    expect(valueFor('Completed samples')).toHaveTextContent('3');
    expect(valueFor('Completed-sample win rate')).toHaveTextContent('33.33%');
    expect(valueFor('Mean completed net return')).toHaveTextContent('0.00%');
    expect(valueFor('Saved BUY recommendations')).toHaveTextContent('8');
    expect(valueFor('New-policy BUY records')).toHaveTextContent('7');
    expect(valueFor('Unavailable / Ineligible / Legacy')).toHaveTextContent('1 / 1 / 1');
    const unknown = screen.getByText('UNKNOWN').closest('tr');
    if (!unknown) throw new Error('Missing unknown row');
    expect(within(unknown).getByText('UNAVAILABLE')).toBeInTheDocument();
    expect(within(unknown).queryByText('0.00%')).not.toBeInTheDocument();
    expect(within(unknown).queryByText('LOSS')).not.toBeInTheDocument();
    const even = screen.getByText('EVEN').closest('tr');
    if (!even) throw new Error('Missing breakeven row');
    expect(within(even).getByText('0.00%')).toBeInTheDocument();
    expect(within(even).getByText('BREAKEVEN')).toBeInTheDocument();
  });

  it('labels future session dates as scheduled and leaves unknown prices and returns unavailable', async () => {
    const snapshot = fixturePaperSnapshot();
    snapshot.page.items[0].entryDate = '2026-09-28';
    snapshot.page.items[0].exitDate = '2026-10-02';
    vi.mocked(getMarketScreenPerformance).mockResolvedValue(snapshot);
    render(<MarketScreenPerformance jobId={FIRST_MARKET_JOB} />);
    await screen.findByText('PAPER');
    expect(screen.getAllByText('Scheduled session')).toHaveLength(2);
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
  });

  it('starts bounded price work only after explicit refresh and disables refresh while the background job runs', async () => {
    const user = userEvent.setup();
    render(<MarketScreenPerformance jobId={FIRST_MARKET_JOB} />);
    await screen.findByRole('table');
    expect(refreshMarketScreenPerformance).not.toHaveBeenCalled();
    const running = fixturePaperSnapshot();
    running.refresh = { status: 'running', selected: 1, processed: 0, reason: null };
    vi.mocked(refreshMarketScreenPerformance).mockResolvedValue(running);
    vi.mocked(getMarketScreenPerformance).mockResolvedValue(running);
    await user.click(screen.getByRole('button', { name: 'Refresh performance' }));
    expect(refreshMarketScreenPerformance).toHaveBeenCalledWith(
      FIRST_MARKET_JOB,
      expect.objectContaining({ limit: 20 })
    );
    expect(await screen.findByText(/Background refresh: 0 \/ 1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refreshing performance...' })).toBeDisabled();
  });

  it('hides preceding page records while a new cache-only page request is pending', async () => {
    const user = userEvent.setup();
    const first = fixturePaperSnapshot();
    first.page.total = 21;
    first.page.hasMore = true;
    vi.mocked(getMarketScreenPerformance).mockResolvedValueOnce(first);
    render(<MarketScreenPerformance jobId={FIRST_MARKET_JOB} />);
    await screen.findByText('PAPER');
    const pending = Promise.withResolvers<MarketScreenPerformanceSnapshot>();
    vi.mocked(getMarketScreenPerformance).mockReturnValueOnce(pending.promise);
    await user.click(screen.getByRole('button', { name: 'Next outcomes' }));
    expect(screen.queryByText('PAPER')).not.toBeInTheDocument();
    expect(refreshMarketScreenPerformance).not.toHaveBeenCalled();
    expect(getMarketScreenPerformance).toHaveBeenLastCalledWith(
      FIRST_MARKET_JOB,
      expect.objectContaining({ offset: 20, limit: 20 })
    );
    const second = fixturePaperSnapshot();
    second.page.offset = 20;
    second.page.items[0].ticker = 'SECOND';
    await act(async () => pending.resolve(second));
    expect(await screen.findByText('SECOND')).toBeInTheDocument();
  });

  it('shows an explicit unavailable read state and allows only a cache retry', async () => {
    const user = userEvent.setup();
    vi.mocked(getMarketScreenPerformance).mockRejectedValueOnce(
      new Error('API error 503: Unavailable')
    );
    render(<MarketScreenPerformance jobId={FIRST_MARKET_JOB} />);
    expect(await screen.findByText('Saved outcomes could not be read')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh performance' })).toBeDisabled();
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry saved outcomes' }));
    expect(await screen.findByText('PAPER')).toBeInTheDocument();
    expect(refreshMarketScreenPerformance).not.toHaveBeenCalled();
  });
});
