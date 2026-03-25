import { describe, expect, it } from 'vitest';
import { reversalConfirm } from '@/services/reversal-confirm';
import type { CandleData } from '@/types';

describe('reversalConfirm', () => {
  const defaultConfig = { enabled: true, volumeMultiplier: 1.0 };

  const makeCandle = (open: number, close: number, volume = 1000): CandleData => ({
    open,
    close,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    volume,
  });

  it('should confirm with bullish candle + volume spike', () => {
    const recentCandles = [
      makeCandle(100, 95),  // day[-2]: bearish (oversold trigger)
      makeCandle(95, 100),  // day[-1]: bullish confirmation
      makeCandle(100, 102), // day[0]: current
    ];
    const result = reversalConfirm({ recentCandles, volumeRatio: 1.5, config: defaultConfig });
    expect(result.status).toBe('confirmed');
    expect(result.trigger).toBe('both');
  });

  it('should confirm with bullish candle without volume spike', () => {
    const recentCandles = [
      makeCandle(100, 95),
      makeCandle(95, 100),
      makeCandle(100, 102),
    ];
    const result = reversalConfirm({ recentCandles, volumeRatio: 0.8, config: defaultConfig });
    expect(result.status).toBe('confirmed');
    expect(result.trigger).toBe('bullish_candle');
  });

  it('should reject with bearish candle', () => {
    const recentCandles = [
      makeCandle(100, 95),
      makeCandle(95, 90),  // day[-1]: bearish — no confirmation
      makeCandle(90, 88),
    ];
    const result = reversalConfirm({ recentCandles, volumeRatio: 1.5, config: defaultConfig });
    expect(result.status).toBe('rejected');
    expect(result.trigger).toBeNull();
  });

  it('should always confirm when disabled', () => {
    const disabledConfig = { enabled: false, volumeMultiplier: 1.0 };
    const recentCandles = [makeCandle(100, 95), makeCandle(95, 90), makeCandle(90, 88)];
    const result = reversalConfirm({ recentCandles, volumeRatio: 0.5, config: disabledConfig });
    expect(result.status).toBe('confirmed');
    expect(result.trigger).toBeNull();
  });

  it('should confirm with fewer than 2 candles (insufficient data)', () => {
    const recentCandles = [makeCandle(100, 102)];
    const result = reversalConfirm({ recentCandles, volumeRatio: 1.0, config: defaultConfig });
    expect(result.status).toBe('confirmed');
  });

  it('should confirm when volume exactly at multiplier', () => {
    const recentCandles = [
      makeCandle(100, 95),
      makeCandle(95, 100),  // bullish
      makeCandle(100, 102),
    ];
    const result = reversalConfirm({ recentCandles, volumeRatio: 1.0, config: defaultConfig });
    expect(result.status).toBe('confirmed');
    expect(result.trigger).toBe('both');
  });
});
