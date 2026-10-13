import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScreenerTable } from '@/components/screener-table';
import type { TickerResult } from '@/lib/api';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const today = new Date('2026-10-14T03:00:00Z');

const rows = [
  {
    ticker: 'AAA',
    date: '2026-10-13',
    close: 10,
    rsi: 50,
    score: 100,
    opinion: 'HOLD',
    patterns: [],
  },
  {
    ticker: 'BBB',
    date: '2026-10-13',
    close: 20,
    rsi: 60,
    score: 300,
    opinion: 'BUY',
    patterns: [],
  },
  {
    ticker: 'CCC',
    date: '2026-10-06',
    close: 30,
    rsi: 75,
    score: 330,
    opinion: 'HOLD',
    patterns: [],
    currency: 'KRW',
  },
] as unknown as TickerResult[];

describe('ScreenerTable', () => {
  it('renders tickers in both table and card views', () => {
    render(<ScreenerTable results={rows} today={today} />);
    expect(screen.getAllByText('AAA').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('BBB').length).toBeGreaterThanOrEqual(1);
  });

  it('sorts by score descending by default (CCC first)', () => {
    render(<ScreenerTable results={rows} today={today} />);
    const table = screen.getByRole('table');
    const tableRows = within(table).getAllByRole('row');
    const cells = within(tableRows[1]).getAllByRole('cell');
    expect(cells[0].textContent).toBe('CCC');
  });

  it('renders all expected column headers as sortable buttons', () => {
    render(<ScreenerTable results={rows} today={today} />);
    const table = screen.getByRole('table');
    for (const label of ['TICKER', 'SESSION', 'CLOSE', 'RSI', 'SCORE', 'SIGNAL']) {
      expect(within(table).getByRole('button', { name: label })).toBeDefined();
    }
    expect(within(table).getByRole('columnheader', { name: /SCORE/ })).toHaveAttribute(
      'aria-sort',
      'descending'
    );
  });

  it('shows a high-scoring HOLD as a blocked setup instead of a green buy cue', () => {
    render(<ScreenerTable results={rows} today={today} />);
    const table = screen.getByRole('table');
    const blocked = within(table).getByLabelText('Signal: HOLD (blocked setup)');
    expect(blocked).toHaveTextContent('HOLD · BLOCKED');
    const row = blocked.closest('tr');
    expect(row).toHaveClass('border-l-warning');
    expect(row).not.toHaveClass('border-l-success');
    expect(within(table).getByLabelText('Signal: HOLD').closest('tr')).toHaveClass(
      'border-l-transparent'
    );
    expect(within(table).getByLabelText('Signal: BUY').closest('tr')).toHaveClass(
      'border-l-success'
    );
  });

  it('flags a row whose session trails the newest session and shows the currency', () => {
    render(<ScreenerTable results={rows} today={today} />);
    const table = screen.getByRole('table');
    const stale = within(table).getAllByLabelText(/Stale session/);
    expect(stale).toHaveLength(1);
    expect(stale[0].closest('tr')).toHaveTextContent('CCC');
    expect(stale[0]).toHaveAttribute('title', expect.stringContaining('2026-10-06'));
    expect(within(table).getByText('30.00 KRW')).toBeInTheDocument();
    expect(within(table).getByText('20.00')).toBeInTheDocument();
  });

  it('labels RSI extremes with text instead of buy/sell colours', () => {
    render(<ScreenerTable results={rows} today={today} />);
    const table = screen.getByRole('table');
    const overbought = within(table).getByLabelText('OVERBOUGHT');
    expect(overbought.parentElement).toHaveClass('text-warning');
    expect(overbought.parentElement).not.toHaveClass('text-destructive');
  });
});
