import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SignalBadge } from '@/components/signal-badge';

describe('SignalBadge', () => {
  it('renders BUY signal with text and aria-label', () => {
    render(<SignalBadge signal="BUY" />);
    expect(screen.getByText('BUY')).toBeDefined();
    expect(screen.getByLabelText('Signal: BUY')).toBeDefined();
  });

  it('renders SELL signal with text and aria-label', () => {
    render(<SignalBadge signal="SELL" />);
    expect(screen.getByText('SELL')).toBeDefined();
    expect(screen.getByLabelText('Signal: SELL')).toBeDefined();
  });

  it('renders HOLD signal with text and aria-label', () => {
    render(<SignalBadge signal="HOLD" />);
    expect(screen.getByText('HOLD')).toBeDefined();
    expect(screen.getByLabelText('Signal: HOLD')).toBeDefined();
  });

  it('renders a blocked HOLD with an explicit text state, not colour alone', () => {
    render(<SignalBadge signal="HOLD" blocked />);
    const badge = screen.getByLabelText('Signal: HOLD (blocked setup)');
    expect(badge).toHaveTextContent('HOLD · BLOCKED');
    expect(badge).toHaveClass('text-warning');
  });

  it('ignores the blocked flag for BUY and SELL', () => {
    render(<SignalBadge signal="BUY" blocked />);
    expect(screen.getByLabelText('Signal: BUY')).toHaveTextContent('BUY');
  });
});
