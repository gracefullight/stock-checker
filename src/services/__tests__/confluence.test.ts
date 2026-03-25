import { describe, expect, it } from 'vitest';
import { confluenceCheck } from '@/services/confluence';

describe('confluenceCheck', () => {
  const defaultConfig = { minActive: 4, activationThreshold: 0.3 };

  it('should pass when 4+ indicators are active', () => {
    const gradients = {
      rsi: 0.8,
      stochK: 0.6,
      bollingerPctB: 0.5,
      donchianPosition: 0.4,
      williamsR: 0.1,
      macd: 0.0,
    };
    const result = confluenceCheck({ gradients, config: defaultConfig });
    expect(result.passed).toBe(true);
    expect(result.activeIndicators).toBe(4);
    expect(result.ratio).toBeCloseTo(4 / 6);
  });

  it('should fail when only 3 indicators are active', () => {
    const gradients = {
      rsi: 0.8,
      stochK: 0.6,
      bollingerPctB: 0.5,
      donchianPosition: 0.2,
      williamsR: 0.1,
      macd: 0.0,
    };
    const result = confluenceCheck({ gradients, config: defaultConfig });
    expect(result.passed).toBe(false);
    expect(result.activeIndicators).toBe(3);
  });

  it('should count indicator exactly at activation threshold as active', () => {
    const gradients = {
      rsi: 0.3,
      stochK: 0.3,
      bollingerPctB: 0.3,
      donchianPosition: 0.3,
      williamsR: 0.0,
      macd: 0.0,
    };
    const result = confluenceCheck({ gradients, config: defaultConfig });
    expect(result.passed).toBe(true);
    expect(result.activeIndicators).toBe(4);
  });

  it('should pass when all 6 indicators are active', () => {
    const gradients = {
      rsi: 1.0,
      stochK: 0.9,
      bollingerPctB: 0.8,
      donchianPosition: 0.7,
      williamsR: 0.6,
      macd: 0.5,
    };
    const result = confluenceCheck({ gradients, config: defaultConfig });
    expect(result.passed).toBe(true);
    expect(result.activeIndicators).toBe(6);
    expect(result.ratio).toBeCloseTo(1.0);
  });

  it('should fail when no indicators are active', () => {
    const gradients = {
      rsi: 0.0,
      stochK: 0.0,
      bollingerPctB: 0.0,
      donchianPosition: 0.0,
      williamsR: 0.0,
      macd: 0.0,
    };
    const result = confluenceCheck({ gradients, config: defaultConfig });
    expect(result.passed).toBe(false);
    expect(result.activeIndicators).toBe(0);
    expect(result.ratio).toBeCloseTo(0);
  });

  it('should use custom activation threshold', () => {
    const gradients = {
      rsi: 0.4,
      stochK: 0.4,
      bollingerPctB: 0.4,
      donchianPosition: 0.4,
      williamsR: 0.4,
      macd: 0.4,
    };
    const highThresholdConfig = { minActive: 4, activationThreshold: 0.5 };
    const result = confluenceCheck({ gradients, config: highThresholdConfig });
    expect(result.passed).toBe(false);
    expect(result.activeIndicators).toBe(0);
  });

  it('should handle missing gradient keys gracefully', () => {
    const gradients = { rsi: 0.8, stochK: 0.8, bollingerPctB: 0.8, donchianPosition: 0.8 };
    const result = confluenceCheck({ gradients, config: defaultConfig });
    expect(result.passed).toBe(true);
    expect(result.activeIndicators).toBe(4);
  });
});
