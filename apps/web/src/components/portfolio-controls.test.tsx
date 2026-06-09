import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PortfolioControls } from '@/components/portfolio-controls';

vi.mock('@/lib/api', () => ({
  addToPortfolio: vi.fn().mockResolvedValue(undefined),
  removeFromPortfolio: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

describe('PortfolioControls', () => {
  it('adds a valid ticker on submit', async () => {
    const { addToPortfolio } = await import('@/lib/api');
    const { toast } = await import('sonner');
    const user = userEvent.setup();

    render(<PortfolioControls tickers={[]} />);

    const input = screen.getByLabelText('Ticker symbol');
    await user.type(input, 'aapl');
    await user.click(screen.getByRole('button', { name: 'ADD' }));

    expect(addToPortfolio).toHaveBeenCalledWith('AAPL');
    expect(toast.success).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('removes a ticker when remove button is clicked', async () => {
    const { removeFromPortfolio } = await import('@/lib/api');
    const user = userEvent.setup();

    render(<PortfolioControls tickers={['AAPL']} />);

    await user.click(screen.getByRole('button', { name: 'Remove AAPL' }));

    expect(removeFromPortfolio).toHaveBeenCalledWith('AAPL');
  });

  it('shows error and does not call api for invalid ticker', async () => {
    const { addToPortfolio } = await import('@/lib/api');
    const { toast } = await import('sonner');
    const user = userEvent.setup();

    vi.mocked(addToPortfolio).mockClear();
    vi.mocked(toast.error).mockClear();

    render(<PortfolioControls tickers={[]} />);

    const input = screen.getByLabelText('Ticker symbol');
    // 'TOOLONGX' is 8 chars, fails /^[A-Z][A-Z.]{0,5}$/ but button is enabled
    await user.type(input, 'TOOLONGX');
    await user.click(screen.getByRole('button', { name: 'ADD' }));

    expect(addToPortfolio).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Invalid ticker symbol');
  });
});
