import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  EarningsWarningBadge,
  isEarningsImminent,
  isEarningsInsideHold,
} from '@/components/common/earnings-warning-badge';

describe('EarningsWarningBadge', () => {
  it('covers the whole five-session hold, not only the three-day proximity window', () => {
    expect(isEarningsImminent(5)).toBe(false);
    expect(isEarningsInsideHold(5)).toBe(true);
    expect(isEarningsInsideHold(6)).toBe(false);
    expect(isEarningsInsideHold(-1)).toBe(false);
    expect(isEarningsInsideHold(null)).toBe(false);
  });

  it('renders the earnings date and hold-window warning text', () => {
    render(<EarningsWarningBadge daysToEarnings={4} nextEarningsDate="2026-10-20T00:00:00Z" />);
    const badge = screen.getByLabelText(
      'Earnings in 4 trading days (2026-10-20), inside the 5-session hold'
    );
    expect(badge).toHaveTextContent('실적 D-4 · 보유구간 내');
  });

  it('renders nothing when earnings fall after the exit session', () => {
    const { container } = render(<EarningsWarningBadge daysToEarnings={9} />);
    expect(container).toBeEmptyDOMElement();
  });
});
