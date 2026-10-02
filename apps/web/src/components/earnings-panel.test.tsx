import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EarningsPanel } from '@/components/earnings-panel';
import type { EarningsDTO } from '@/lib/api';

const earnings: EarningsDTO = {
  ticker: 'AAPL',
  nextEarningsDate: null,
  nextEarningsEstimate: null,
  estimateRevisions: null,
  earningsHistory: [],
};

describe('earnings financial presentation', () => {
  it('identifies a fiscal-quarter date instead of implying a publication date', () => {
    render(
      <EarningsPanel
        earnings={{
          ...earnings,
          earningsHistory: [
            {
              reportDate: '2026-06-30T00:00:00Z',
              dateBasis: 'fiscal-quarter',
              epsActual: -0.5,
              epsEstimate: -0.6,
              epsDifference: 0.1,
              surprisePercent: 16.7,
            },
          ],
        }}
      />
    );

    expect(screen.getByText('2026-06-30 (quarter)')).toBeInTheDocument();
  });

  it('shows missing analyst revision counts as unknown instead of zero', () => {
    render(
      <EarningsPanel
        earnings={{
          ...earnings,
          estimateRevisions: {
            up30: null,
            down30: null,
            current: null,
            thirtyDaysAgo: null,
            direction: null,
          },
        }}
      />
    );

    expect(screen.getByText('▲—')).toBeInTheDocument();
    expect(screen.getByText('▼—')).toBeInTheDocument();
  });

  it('labels zero earnings surprise as met rather than beat', () => {
    render(
      <EarningsPanel
        earnings={{
          ...earnings,
          earningsHistory: [
            {
              reportDate: '2026-07-31T00:00:00Z',
              dateBasis: 'reported',
              epsActual: 1,
              epsEstimate: 1,
              epsDifference: 0,
              surprisePercent: 0,
            },
          ],
        }}
      />
    );

    expect(within(screen.getByRole('table')).getByText('0.0% MET')).toBeInTheDocument();
  });
});
