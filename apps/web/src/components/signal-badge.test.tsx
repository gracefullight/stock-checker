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
});
