import { describe, expect, it } from 'vitest';
import { gaussianChannel } from '@/services/gaussian-channel';

/**
 * Generates a monotonically rising series of length n starting at `start` with step `step`.
 */
function risingPrices(n: number, start = 100, step = 1): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

function fallingPrices(n: number, start = 200, step = 1): number[] {
  return Array.from({ length: n }, (_, i) => start - i * step);
}

function flatPrices(n: number, value = 100): number[] {
  return Array.from({ length: n }, () => value);
}

describe('gaussianChannel', () => {
  it('returns direction "up" and isGreen=true for monotonically rising input', () => {
    const prices = risingPrices(200);
    const result = gaussianChannel(prices, { period: 20, poles: 4, mult: 1.4 });
    expect(result.direction).toBe('up');
    expect(result.isGreen).toBe(true);
  });

  it('returns direction "down" and isGreen=false for monotonically falling input', () => {
    const prices = fallingPrices(200);
    const result = gaussianChannel(prices, { period: 20, poles: 4, mult: 1.4 });
    expect(result.direction).toBe('down');
    expect(result.isGreen).toBe(false);
  });

  it('returns direction "flat" for near-constant input', () => {
    const prices = flatPrices(200, 100);
    const result = gaussianChannel(prices, { period: 20, poles: 4, mult: 1.4 });
    expect(result.direction).toBe('flat');
    expect(result.isGreen).toBe(false);
  });

  it('bands bracket the mid (upper > mid > lower)', () => {
    // A price series with some variance so the band is non-zero
    const prices = risingPrices(200, 100, 1);
    // Add some noise to ensure TR > 0
    const noisyPrices = prices.map((p, i) => p + (i % 2 === 0 ? 0.5 : -0.5));
    const result = gaussianChannel(noisyPrices, { period: 20, poles: 4, mult: 1.4 });
    expect(result.upper).toBeGreaterThan(result.mid);
    expect(result.lower).toBeLessThan(result.mid);
  });

  it('returns full series of same length as input', () => {
    const prices = risingPrices(150);
    const result = gaussianChannel(prices, { period: 20, poles: 4, mult: 1.4 });
    expect(result.series).toHaveLength(150);
  });

  it('series last element matches the latest-bar result', () => {
    const prices = risingPrices(100);
    const result = gaussianChannel(prices);
    const last = result.series[result.series.length - 1];
    expect(result.mid).toBeCloseTo(last.mid, 8);
    expect(result.upper).toBeCloseTo(last.upper, 8);
    expect(result.lower).toBeCloseTo(last.lower, 8);
    expect(result.direction).toBe(last.direction);
  });

  it('handles minimum input of length 2 without throwing', () => {
    expect(() => gaussianChannel([100, 101])).not.toThrow();
  });

  it('handles single-element input gracefully', () => {
    const result = gaussianChannel([100]);
    expect(result.mid).toBe(100);
    expect(result.direction).toBe('flat');
  });

  it('uses defaults (period=144, poles=4, mult=1.4) when no opts provided', () => {
    const prices = risingPrices(200);
    // Should not throw and should return a valid result
    const result = gaussianChannel(prices);
    expect(typeof result.mid).toBe('number');
    expect(typeof result.isGreen).toBe('boolean');
  });

  it('series direction transitions from flat to up for late-rising price', () => {
    // First 100 bars flat, then 100 bars rising — by the end filter should be rising
    const prices = [...flatPrices(100, 100), ...risingPrices(100, 100, 2)];
    const result = gaussianChannel(prices, { period: 20, poles: 4, mult: 1.4 });
    expect(result.direction).toBe('up');
  });

  it('isGreen is consistent with direction', () => {
    const prices = risingPrices(200);
    const result = gaussianChannel(prices, { period: 20, poles: 4, mult: 1.4 });
    for (const point of result.series) {
      expect(point.isGreen).toBe(point.direction === 'up');
    }
  });
});
