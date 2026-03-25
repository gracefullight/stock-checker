import { describe, expect, it } from 'vitest';
import { linearGradient, gradientScore } from '@/services/analysis';
import { DEFAULT_PIPELINE_CONFIG } from '@/constants';
import type { IndicatorValues } from '@/types';

function makeIndicators(overrides: Partial<IndicatorValues> = {}): IndicatorValues {
  return {
    rsi: 50,
    stochasticK: 50,
    bbLower: 90,
    bbUpper: 110,
    donchLower: 85,
    donchUpper: 115,
    williamsR: -50,
    atr: 5,
    macd: 0,
    macdSignal: 0,
    macdHistogram: 0,
    sma20: 100,
    ema20: 100,
    sma50: 98,
    sma200: 95,
    volumeRatio: 1.0,
    ...overrides,
  };
}

describe('linearGradient', () => {
  // Normal direction (lower = stronger, e.g., RSI oversold: max=15, mid=30, zero=40)
  it('should return 1.0 at max value', () => {
    expect(linearGradient(15, 15, 30, 40)).toBe(1.0);
    expect(linearGradient(10, 15, 30, 40)).toBe(1.0);
  });

  it('should return 0.0 at zero value', () => {
    expect(linearGradient(40, 15, 30, 40)).toBe(0.0);
    expect(linearGradient(50, 15, 30, 40)).toBe(0.0);
  });

  it('should return 0.5 at mid value', () => {
    expect(linearGradient(30, 15, 30, 40)).toBeCloseTo(0.5);
  });

  it('should interpolate between max and mid', () => {
    const result = linearGradient(22.5, 15, 30, 40);
    expect(result).toBeGreaterThan(0.5);
    expect(result).toBeLessThan(1.0);
  });

  it('should interpolate between mid and zero', () => {
    const result = linearGradient(35, 15, 30, 40);
    expect(result).toBeGreaterThan(0.0);
    expect(result).toBeLessThan(0.5);
  });

  // Inverted direction (higher = stronger, e.g., RSI overbought: max=85, mid=70, zero=60)
  it('should handle inverted direction (higher = stronger)', () => {
    expect(linearGradient(85, 85, 70, 60)).toBe(1.0);
    expect(linearGradient(90, 85, 70, 60)).toBe(1.0);
    expect(linearGradient(60, 85, 70, 60)).toBe(0.0);
    expect(linearGradient(50, 85, 70, 60)).toBe(0.0);
    expect(linearGradient(70, 85, 70, 60)).toBeCloseTo(0.5);
  });
});

describe('gradientScore', () => {
  const config = { ...DEFAULT_PIPELINE_CONFIG };

  it('should produce high buyScore for deeply oversold conditions', () => {
    const indicators = makeIndicators({
      rsi: 10,
      stochasticK: 5,
      williamsR: -95,
      bbLower: 102,
      bbUpper: 120,
      donchLower: 100,
      donchUpper: 130,
    });
    const result = gradientScore({
      indicators,
      close: 98,
      fearGreed: 15,
      patternScore: 70,
      recentMacdHistogram: [-0.5, -0.2, 0.1],
      config,
    });
    expect(result.buyScore).toBeGreaterThan(200);
  });

  it('should produce near-zero buyScore for neutral conditions', () => {
    const indicators = makeIndicators();
    const result = gradientScore({
      indicators,
      close: 100,
      fearGreed: 50,
      patternScore: 0,
      recentMacdHistogram: [0.1, 0.2, -0.1],
      config,
    });
    expect(result.buyScore).toBeLessThan(100);
  });

  it('should detect MACD positive crossover', () => {
    const indicators = makeIndicators();
    const result = gradientScore({
      indicators,
      close: 100,
      fearGreed: 50,
      patternScore: 0,
      recentMacdHistogram: [-0.5, -0.3, 0.1], // crossover!
      config,
    });
    expect(result.gradients.macd).toBe(1.0);
  });

  it('should decay MACD gradient for sustained positive', () => {
    const indicators = makeIndicators();
    const result = gradientScore({
      indicators,
      close: 100,
      fearGreed: 50,
      patternScore: 0,
      recentMacdHistogram: [0.1, 0.2, 0.3, 0.4], // sustained positive
      config,
    });
    expect(result.gradients.macd).toBeLessThan(1.0);
    expect(result.gradients.macd).toBeGreaterThan(0);
  });

  it('should produce sellScore for overbought conditions', () => {
    const indicators = makeIndicators({
      rsi: 80,
      stochasticK: 85,
      williamsR: -10,
    });
    const result = gradientScore({
      indicators,
      close: 110,
      fearGreed: 70,
      patternScore: 0,
      recentMacdHistogram: [0.5, 0.2, -0.3],
      config,
    });
    expect(result.sellScore).toBeGreaterThan(0);
  });

  it('should return gradient values for all confluence indicators', () => {
    const indicators = makeIndicators({ rsi: 10 });
    const result = gradientScore({
      indicators,
      close: 100,
      fearGreed: 50,
      patternScore: 0,
      recentMacdHistogram: [0, 0],
      config,
    });
    expect(result.gradients).toHaveProperty('rsi');
    expect(result.gradients).toHaveProperty('stochK');
    expect(result.gradients).toHaveProperty('bollingerPctB');
    expect(result.gradients).toHaveProperty('donchianPosition');
    expect(result.gradients).toHaveProperty('williamsR');
    expect(result.gradients).toHaveProperty('macd');
    expect(result.gradients.rsi).toBe(1.0);
  });
});
