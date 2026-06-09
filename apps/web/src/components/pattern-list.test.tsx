import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PatternList } from '@/components/pattern-list';

describe('PatternList', () => {
  it('renders em dash when patterns array is empty', () => {
    render(<PatternList patterns={[]} />);
    expect(screen.getByText('—')).toBeDefined();
  });

  it('renders all patterns as listitems inside a list', () => {
    render(<PatternList patterns={['ThreeRisingValleys', 'BearishEngulfing']} />);
    expect(screen.getByText('ThreeRisingValleys')).toBeDefined();
    expect(screen.getByText('BearishEngulfing')).toBeDefined();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('list')).toBeDefined();
  });
});
