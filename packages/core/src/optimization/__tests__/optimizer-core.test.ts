import { describe, expect, it } from 'vitest';
import { optimizeWithData } from '@/optimization/optimizer-core';

function candles(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2024, 0, i + 1)),
    open: 100 + i / 10,
    high: 101 + i / 10,
    low: 99 + i / 10,
    close: 100 + i / 10,
    volume: 1_000_000,
  }));
}

describe('optimizer signal-context minimum', () => {
  it.each([
    200, 209,
  ])('rejects %i bars rather than reporting an unevaluated zero-trade optimum', (count) => {
    expect(() => optimizeWithData(candles(count), 1)).toThrow(`Insufficient data: ${count} bars`);
  });

  it('accepts the shared signal context minimum of 210 bars', () => {
    expect(() => optimizeWithData(candles(210), 1)).not.toThrow();
  });
});
