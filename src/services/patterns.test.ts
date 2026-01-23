import { describe, it, expect } from 'vitest';
import { detectPatterns } from './patterns';
import type { PatternResult } from '../types';

describe('patterns', () => {
  it('should detect ascending triangle pattern', () => {
    const highs = [100, 100.5, 100.2, 100.8, 100.3];
    const lows = [95, 96, 97, 98, 99];

    const result = detectPatterns({ highs, lows, closes: [] });

    expect(result.score).toBeGreaterThan(0);
    expect(result.patterns).toContain('AscendingTriangle');
  });

  it('should return no patterns when none detected', () => {
    const result = detectPatterns({ highs: [], lows: [], closes: [] });

    expect(result.score).toBe(0);
    expect(result.patterns).toHaveLength(0);
  });
});
