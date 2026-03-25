import { describe, expect, it } from 'vitest';
import { trendGate } from '@/services/trend-gate';

describe('trendGate', () => {
  const defaultConfig = { enabled: true, minConditions: 2, sidewaysThreshold: 2 };

  it('should pass in uptrend (all 3 conditions met)', () => {
    const result = trendGate({ close: 150, sma50: 140, sma200: 120, config: defaultConfig });
    expect(result.passed).toBe(true);
    expect(result.regime).toBe('uptrend');
    expect(result.strength).toBeCloseTo(100);
  });

  it('should fail in downtrend (0 conditions met)', () => {
    const result = trendGate({ close: 100, sma50: 120, sma200: 140, config: defaultConfig });
    expect(result.passed).toBe(false);
    expect(result.regime).toBe('downtrend');
    expect(result.strength).toBeCloseTo(0);
  });

  it('should pass when 2 of 3 conditions met', () => {
    // close > sma200 (yes), sma50 > sma200 (no), close > sma50 (yes)
    const result = trendGate({ close: 135, sma50: 130, sma200: 125, config: defaultConfig });
    expect(result.passed).toBe(true);
  });

  it('should fail when only 1 of 3 conditions met with minConditions=2', () => {
    // close > sma200 (no), sma50 > sma200 (yes), close > sma50 (no)
    const result = trendGate({ close: 115, sma50: 130, sma200: 125, config: defaultConfig });
    expect(result.passed).toBe(false);
  });

  it('should relax in sideways market', () => {
    // SMA50 ~= SMA200 (diff < 2%), close between them
    // close > sma200 (yes), sma50 > sma200 (no, 99 < 100), close > sma50 (yes)
    // But sideways: diff = 1%, so minConditions relaxed from 2 to 1
    const result = trendGate({ close: 99.5, sma50: 99, sma200: 100, config: defaultConfig });
    expect(result.passed).toBe(true);
    expect(result.regime).toBe('sideways');
  });

  it('should pass when SMA200 is NaN (insufficient data)', () => {
    const result = trendGate({ close: 100, sma50: 95, sma200: NaN, config: defaultConfig });
    expect(result.passed).toBe(true);
    expect(result.regime).toBe('unknown');
  });

  it('should pass when SMA50 is NaN', () => {
    const result = trendGate({ close: 100, sma50: NaN, sma200: 90, config: defaultConfig });
    expect(result.passed).toBe(true);
    expect(result.regime).toBe('unknown');
  });

  it('should always pass when disabled', () => {
    const disabledConfig = { ...defaultConfig, enabled: false };
    const result = trendGate({ close: 100, sma50: 120, sma200: 140, config: disabledConfig });
    expect(result.passed).toBe(true);
  });

  it('should fail with minConditions=3 when only 2 met', () => {
    const strictConfig = { ...defaultConfig, minConditions: 3 };
    // close > sma200 (yes), sma50 > sma200 (yes), close > sma50 (no) → 2/3
    const result = trendGate({ close: 128, sma50: 130, sma200: 125, config: strictConfig });
    expect(result.passed).toBe(false);
  });
});
