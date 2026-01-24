import { describe, expect, it } from 'vitest';
import { calculateAllIndicators } from '@/services/indicators';

describe('indicators', () => {
  it('should calculate all indicators from price data', () => {
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109];
    const highs = [105, 106, 107, 108, 109, 110, 111, 112, 113, 114];
    const lows = [95, 96, 97, 98, 99, 100, 101, 102, 103, 104];

    const result = calculateAllIndicators({ closes, highs, lows });

    expect(result).toHaveProperty('rsi');
    expect(result).toHaveProperty('stochasticK');
    expect(result).toHaveProperty('bbLower');
    expect(result).toHaveProperty('bbUpper');
    expect(result).toHaveProperty('williamsR');
    expect(result).toHaveProperty('atr');
  });
});
