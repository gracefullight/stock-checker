import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INSTITUTIONAL_PIPELINE_CONFIG,
  DEFAULT_PIPELINE_CONFIG,
  MEAN_REVERSION_GRADIENT_RANGES,
} from '@/constants';
import { gradientScore, institutionalGradientScore, linearGradient } from '@/services/analysis';
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
  // Mean-reversion config: tests the original oversold-scoring behavior
  const config = {
    ...DEFAULT_PIPELINE_CONFIG,
    strategy: 'mean-reversion' as const,
    indicatorWeights: {
      ...DEFAULT_PIPELINE_CONFIG.indicatorWeights,
      rsi: 79,
      stochastic: 76,
      bollinger: 78,
      donchian: 74,
      williamsR: 72,
      fearGreed: 50,
      macd: 75,
      sma: 60,
      ema: 65,
      volume: 0,
    },
    gradientRanges: { ...MEAN_REVERSION_GRADIENT_RANGES },
  };

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

// --- C3: Flow-primary dominance for 'institutional' strategy ---
//
// Asserts: a +0.3 gradient-unit increase in a FLOW input raises buyScore MORE than
// a +0.3 gradient-unit increase in RSI.
//
// This is the correct "same magnitude" comparison — we move each input's gradient
// value by the same +0.3 step so the comparison is weight × step for each:
//   rsSpy    weight = 120  →  120 × 0.3 = 36
//   vwap     weight =  90  →   90 × 0.3 = 27
//   brkVol   weight = 110  →  110 × 0.3 = 33
//   RSI      weight =  40  →   40 × 0.3 = 12   ← always lower than any flow component
//
// Flow dominance holds at the gradient-unit level as designed.
describe('institutionalGradientScore — flow-primary dominance', () => {
  const instConfig = DEFAULT_INSTITUTIONAL_PIPELINE_CONFIG;

  // Shared neutral base so neither flow nor oscillators are pre-saturated
  const baseIndicators = makeIndicators({
    rsi: 50,
    stochasticK: 50,
    williamsR: -50,
  });
  const baseFlow = {
    rsSpy: 0.5,
    rsSector: 0.5,
    vwap: 0.5,
    breakoutVol: 0.5,
    liquidity: 0.5,
    earnings: 0.5,
  };
  // RSI at 50 in momentum range: grad = 0.5 * (50-45)/(60-45) ≈ 0.167
  // RSI at 50+X where X moves the gradient by +0.3:
  //   grad(rsi) = 0.5 * (rsi - 45) / (60 - 45)  for rsi in [45, 60]
  //   0.167 + 0.3 = 0.467 → rsi = 45 + 0.467 * 2 * 15 = 45 + 14 = 59
  // So RSI from 50 → 59 gives the same +0.3 gradient-unit step.
  const rsiWithGradStep = 59;

  const baseParams = {
    indicators: baseIndicators,
    close: 100,
    fearGreed: 50,
    patternScore: 0,
    recentMacdHistogram: [0, 0],
    config: instConfig,
  };

  it('increasing rsSpy gradient by 0.3 raises buyScore more than increasing RSI gradient by 0.3', () => {
    const base = institutionalGradientScore({ ...baseParams, flowInputs: baseFlow });

    // +0.3 gradient step on rsSpy (W_RS_SPY = 120) → delta = 36
    const flowBumped = institutionalGradientScore({
      ...baseParams,
      flowInputs: { ...baseFlow, rsSpy: baseFlow.rsSpy + 0.3 },
    });

    // +0.3 gradient step on RSI (W_RSI = 40) → delta = 12
    const rsiBumped = institutionalGradientScore({
      ...baseParams,
      indicators: makeIndicators({ ...baseIndicators, rsi: rsiWithGradStep }),
      flowInputs: baseFlow,
    });

    const deltaFromFlow = flowBumped.buyScore - base.buyScore;
    const deltaFromRsi = rsiBumped.buyScore - base.buyScore;

    // Flow delta must exceed RSI delta (core design invariant)
    expect(deltaFromFlow).toBeGreaterThan(0);
    expect(deltaFromFlow).toBeGreaterThan(deltaFromRsi);
  });

  it('increasing vwap gradient by 0.3 raises buyScore more than increasing RSI gradient by 0.3', () => {
    const base = institutionalGradientScore({ ...baseParams, flowInputs: baseFlow });

    // +0.3 gradient step on vwap (W_VWAP = 90) → delta = 27
    const flowBumped = institutionalGradientScore({
      ...baseParams,
      flowInputs: { ...baseFlow, vwap: baseFlow.vwap + 0.3 },
    });

    // +0.3 gradient step on RSI (W_RSI = 40) → delta = 12
    const rsiBumped = institutionalGradientScore({
      ...baseParams,
      indicators: makeIndicators({ ...baseIndicators, rsi: rsiWithGradStep }),
      flowInputs: baseFlow,
    });

    const deltaFromFlow = flowBumped.buyScore - base.buyScore;
    const deltaFromRsi = rsiBumped.buyScore - base.buyScore;

    expect(deltaFromFlow).toBeGreaterThan(deltaFromRsi);
  });

  it('increasing breakoutVol gradient by 0.3 raises buyScore more than increasing RSI gradient by 0.3', () => {
    const base = institutionalGradientScore({ ...baseParams, flowInputs: baseFlow });

    // +0.3 gradient step on breakoutVol (W_BREAKOUT_VOL = 110) → delta = 33
    const flowBumped = institutionalGradientScore({
      ...baseParams,
      flowInputs: { ...baseFlow, breakoutVol: baseFlow.breakoutVol + 0.3 },
    });

    // +0.3 gradient step on RSI (W_RSI = 40) → delta = 12
    const rsiBumped = institutionalGradientScore({
      ...baseParams,
      indicators: makeIndicators({ ...baseIndicators, rsi: rsiWithGradStep }),
      flowInputs: baseFlow,
    });

    const deltaFromFlow = flowBumped.buyScore - base.buyScore;
    const deltaFromRsi = rsiBumped.buyScore - base.buyScore;

    expect(deltaFromFlow).toBeGreaterThan(deltaFromRsi);
  });
});
