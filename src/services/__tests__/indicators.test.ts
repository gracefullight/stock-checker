import { describe, expect, it } from 'vitest';
import { calculateAllIndicators } from '@/services/indicators';

describe('indicators', () => {
  it('should calculate all indicators from price data', () => {
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109];
    const highs = [105, 106, 107, 108, 109, 110, 111, 112, 113, 114];
    const lows = [95, 96, 97, 98, 99, 100, 101, 102, 103, 104];
    const volumes = [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900];

    const result = calculateAllIndicators({ closes, highs, lows, volumes });

    expect(result).toHaveProperty('rsi');
    expect(result).toHaveProperty('stochasticK');
    expect(result).toHaveProperty('bbLower');
    expect(result).toHaveProperty('bbUpper');
    expect(result).toHaveProperty('williamsR');
    expect(result).toHaveProperty('atr');
    expect(result).toHaveProperty('sma50');
    expect(result).toHaveProperty('sma200');
    expect(result).toHaveProperty('volumeRatio');
  });

  it('should return NaN for SMA50/SMA200 with insufficient data', () => {
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109];
    const highs = [105, 106, 107, 108, 109, 110, 111, 112, 113, 114];
    const lows = [95, 96, 97, 98, 99, 100, 101, 102, 103, 104];

    const result = calculateAllIndicators({ closes, highs, lows });

    expect(result.sma50).toBeNaN();
    expect(result.sma200).toBeNaN();
  });

  it('should calculate SMA50 with 50+ data points', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const highs = closes.map((c) => c + 5);
    const lows = closes.map((c) => c - 5);

    const result = calculateAllIndicators({ closes, highs, lows });

    expect(Number.isFinite(result.sma50)).toBe(true);
    expect(result.sma200).toBeNaN();
  });

  it('should calculate SMA200 with 200+ data points', () => {
    const closes = Array.from({ length: 210 }, (_, i) => 100 + Math.sin(i / 10) * 10);
    const highs = closes.map((c) => c + 5);
    const lows = closes.map((c) => c - 5);
    const volumes = Array.from({ length: 210 }, () => 1000 + Math.random() * 500);

    const result = calculateAllIndicators({ closes, highs, lows, volumes });

    expect(Number.isFinite(result.sma50)).toBe(true);
    expect(Number.isFinite(result.sma200)).toBe(true);
    expect(result.volumeRatio).toBeGreaterThan(0);
  });

  it('should default volumeRatio to 1.0 without volumes', () => {
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109];
    const highs = [105, 106, 107, 108, 109, 110, 111, 112, 113, 114];
    const lows = [95, 96, 97, 98, 99, 100, 101, 102, 103, 104];

    const result = calculateAllIndicators({ closes, highs, lows });

    expect(result.volumeRatio).toBe(1.0);
  });
});
