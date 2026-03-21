import { describe, expect, it } from 'vitest';
import { detectPatterns } from '@/services/patterns';

describe('patterns', () => {
  it('should detect ascending triangle pattern', () => {
    const highs = [100, 100.5, 100.2, 100.8, 100.3];
    const lows = [95, 96, 97, 98, 99];

    const result = detectPatterns({ highs, lows, closes: [] });

    expect(result.score).toBeGreaterThan(0);
    expect(result.patterns).toContain('AscendingTriangle');
  });

  it('should detect descending triangle pattern', () => {
    const highs = [105, 104, 103, 102, 101];
    const lows = [95, 95.2, 95.1, 95.3, 95.0];

    const result = detectPatterns({ highs, lows, closes: [] });

    expect(result.score).toBeLessThan(0);
    expect(result.patterns).toContain('DescendingTriangle');
  });

  it('should detect bearish flag pattern', () => {
    const closes = [100, 93, 93.5, 93.2, 93.8, 93.4, 93.6, 93.3, 93.7, 93.5];

    const result = detectPatterns({ highs: [], lows: [], closes });

    expect(result.score).toBeLessThan(0);
    expect(result.patterns).toContain('BearishFlag');
  });

  it('should detect double top pattern', () => {
    const highs = [95, 96, 100, 98, 97, 96, 95, 94, 93, 92, 91, 93, 100, 98, 97, 96, 95, 94, 93, 92];

    const result = detectPatterns({ highs, lows: [], closes: [] });

    expect(result.score).toBeLessThan(0);
    expect(result.patterns).toContain('DoubleTop');
  });

  it('should detect rising wedge pattern', () => {
    const highs = [100, 101, 102, 103, 104, 105];
    const lows = [90, 92, 94, 96, 98, 100];

    const result = detectPatterns({ highs, lows, closes: [] });

    expect(result.score).toBeLessThan(0);
    expect(result.patterns).toContain('RisingWedge');
  });

  it('should detect head and shoulders pattern', () => {
    const highs = [95, 96, 98, 97, 96, 95, 97, 100, 99, 96, 95, 96, 98, 97, 96];

    const result = detectPatterns({ highs, lows: [], closes: [] });

    expect(result.score).toBeLessThan(0);
    expect(result.patterns).toContain('HeadAndShoulders');
  });

  it('should return no patterns when none detected', () => {
    const result = detectPatterns({ highs: [], lows: [], closes: [] });

    expect(result.score).toBe(0);
    expect(result.patterns).toHaveLength(0);
  });
});
