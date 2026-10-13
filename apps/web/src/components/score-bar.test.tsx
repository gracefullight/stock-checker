import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScoreBar } from '@/components/score-bar';

describe('ScoreBar', () => {
  it('uses the config score cap as the meter maximum and labels the decision', () => {
    render(<ScoreBar value={300} decision="BUY" />);
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('300');
    expect(meter.getAttribute('aria-valuemax')).toBe('400');
    expect(meter.getAttribute('aria-label')).toBe('Score: 300 of 400 (BUY)');
    expect(screen.getByText('300')).toBeDefined();
    expect(screen.getByText('BUY')).toHaveClass('text-success');
  });

  it('shows a high-scoring HOLD as BLOCKED in amber, not as a green buy', () => {
    render(<ScoreBar value={320} decision="HOLD" />);
    expect(screen.getByRole('meter').getAttribute('aria-label')).toBe(
      'Score: 320 of 400 (BLOCKED)'
    );
    const label = screen.getByText('BLOCKED');
    expect(label).toHaveClass('text-warning');
    expect(document.querySelector('[data-slot="progress-indicator"]')).toHaveClass('bg-warning');
  });

  it('keeps a low-scoring HOLD muted', () => {
    render(<ScoreBar value={100} decision="HOLD" />);
    expect(screen.getByText('HOLD')).toHaveClass('text-muted-foreground');
    expect(document.querySelector('[data-slot="progress-indicator"]')).not.toHaveClass(
      'bg-success'
    );
  });

  it('honours frozen thresholds and an explicit max', () => {
    render(
      <ScoreBar
        value={100}
        decision="HOLD"
        thresholds={{ buy: 90, sell: 50, scoreMax: 200 }}
        max={200}
      />
    );
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuemax')).toBe('200');
    expect(meter.getAttribute('aria-label')).toBe('Score: 100 of 200 (BLOCKED)');
  });

  it('rounds fractional values for display', () => {
    render(<ScoreBar value={150.7} decision="HOLD" />);
    expect(screen.getByText('151')).toBeDefined();
  });
});
