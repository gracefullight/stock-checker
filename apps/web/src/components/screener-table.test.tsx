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

const rows = [
  {
    ticker: 'AAA',
    close: 10,
    rsi: 50,
    score: 100,
    opinion: 'HOLD',
    patterns: [],
  },
  {
    ticker: 'BBB',
    close: 20,
    rsi: 60,
    score: 300,
    opinion: 'BUY',
    patterns: [],
  },
] as unknown as TickerResult[];

describe('ScreenerTable', () => {
  it('renders tickers in both table and card views', () => {
    render(<ScreenerTable results={rows} />);
    expect(screen.getAllByText('AAA').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('BBB').length).toBeGreaterThanOrEqual(1);
  });

  it('sorts by score descending by default (BBB first)', () => {
    render(<ScreenerTable results={rows} />);
    const table = screen.getByRole('table');
    const tableRows = within(table).getAllByRole('row');
    // tableRows[0] is header, tableRows[1] is first data row
    const firstDataRow = tableRows[1];
    const cells = within(firstDataRow).getAllByRole('cell');
    expect(cells[0].textContent).toBe('BBB');
  });

  it('renders all expected column headers', () => {
    render(<ScreenerTable results={rows} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('TICKER')).toBeDefined();
    expect(within(table).getByText('CLOSE')).toBeDefined();
    expect(within(table).getByText('RSI')).toBeDefined();
    expect(within(table).getByText('SCORE')).toBeDefined();
    expect(within(table).getByText('SIGNAL')).toBeDefined();
  });
});
