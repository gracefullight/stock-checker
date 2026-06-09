import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScoreBar } from '@/components/score-bar';

describe('ScoreBar', () => {
  it('renders meter with correct aria attributes and value text', () => {
    render(<ScoreBar value={300} />);
    const meter = screen.getByRole('meter');
    expect(meter).toBeDefined();
    expect(meter.getAttribute('aria-valuenow')).toBe('300');
    expect(meter.getAttribute('aria-valuemax')).toBe('600');
    expect(meter.getAttribute('aria-label')).toBe('Score: 300 of 600');
    expect(screen.getByText('300')).toBeDefined();
  });

  it('uses the provided max value', () => {
    render(<ScoreBar value={100} max={200} />);
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuemax')).toBe('200');
    expect(meter.getAttribute('aria-label')).toBe('Score: 100 of 200');
  });

  it('rounds fractional values for display', () => {
    render(<ScoreBar value={150.7} />);
    expect(screen.getByText('151')).toBeDefined();
  });
});
