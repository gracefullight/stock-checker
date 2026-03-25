import { describe, expect, it } from 'vitest';
import { evaluateSignal } from '@/services/pipeline';
import { DEFAULT_PIPELINE_CONFIG } from '@/constants';
import type { CandleData, IndicatorValues, PipelineConfig } from '@/types';

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
    volumeRatio: 1.2,
    ...overrides,
  };
}

function makeCandle(open: number, close: number): CandleData {
  return {
    open,
    close,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    volume: 1000,
  };
}

const config: PipelineConfig = { ...DEFAULT_PIPELINE_CONFIG };

describe('evaluateSignal', () => {
  it('should return BUY when all gates pass (deeply oversold + uptrend + confirmation)', () => {
    const indicators = makeIndicators({
      rsi: 12,
      stochasticK: 8,
      williamsR: -92,
      bbLower: 100,
      bbUpper: 120,
      donchLower: 98,
      donchUpper: 125,
      sma20: 96,
      ema20: 96,
      sma50: 102,
      sma200: 95,
      volumeRatio: 1.5,
    });
    const recentCandles = [
      makeCandle(100, 95),  // day[-2]
      makeCandle(95, 100),  // day[-1]: bullish confirmation
      makeCandle(100, 98),  // day[0]
    ];
    const result = evaluateSignal({
      ticker: 'TEST',
      indicators,
      close: 98,
      open: 100,
      fearGreed: 15,
      patternScore: 70,
      recentCandles,
      recentMacdHistogram: [-0.5, -0.2, 0.1],
      config,
    });
    expect(result.finalDecision).toBe('BUY');
    expect(result.gateResults.trend.passed).toBe(true);
    expect(result.gateResults.confluence.passed).toBe(true);
    expect(result.gateResults.reversal.status).toBe('confirmed');
  });

  it('should return HOLD when trend gate blocks (downtrend)', () => {
    const indicators = makeIndicators({
      rsi: 12,
      stochasticK: 8,
      williamsR: -92,
      bbLower: 100,
      bbUpper: 120,
      donchLower: 98,
      donchUpper: 125,
      sma50: 90,
      sma200: 110, // downtrend: SMA50 < SMA200, close < SMA200
      volumeRatio: 1.5,
    });
    const recentCandles = [makeCandle(100, 95), makeCandle(95, 100), makeCandle(100, 98)];
    const result = evaluateSignal({
      ticker: 'TEST',
      indicators,
      close: 85,
      open: 90,
      fearGreed: 15,
      patternScore: 70,
      recentCandles,
      recentMacdHistogram: [-0.5, -0.2, 0.1],
      config,
    });
    expect(result.finalDecision).toBe('HOLD');
    expect(result.gateResults.trend.passed).toBe(false);
  });

  it('should return HOLD when confluence check fails (too few active indicators)', () => {
    // Only RSI is deeply oversold, others neutral → confluence fails
    const indicators = makeIndicators({
      rsi: 12,
      stochasticK: 50,
      williamsR: -50,
      sma50: 102,
      sma200: 95,
      volumeRatio: 1.2,
    });
    const recentCandles = [makeCandle(100, 95), makeCandle(95, 100), makeCandle(100, 98)];
    const result = evaluateSignal({
      ticker: 'TEST',
      indicators,
      close: 100,
      open: 100,
      fearGreed: 50,
      patternScore: 0,
      recentCandles,
      recentMacdHistogram: [0.1, 0.2, -0.1],
      config,
    });
    expect(result.finalDecision).toBe('HOLD');
  });

  it('should return HOLD when reversal confirmation fails (bearish candle)', () => {
    const indicators = makeIndicators({
      rsi: 12,
      stochasticK: 8,
      williamsR: -92,
      bbLower: 100,
      bbUpper: 120,
      donchLower: 98,
      donchUpper: 125,
      sma20: 96,
      ema20: 96,
      sma50: 102,
      sma200: 95,
      volumeRatio: 1.5,
    });
    // day[-1] is bearish → reversal rejected
    const recentCandles = [
      makeCandle(100, 95),
      makeCandle(95, 90),  // bearish!
      makeCandle(90, 88),
    ];
    const result = evaluateSignal({
      ticker: 'TEST',
      indicators,
      close: 98,
      open: 100,
      fearGreed: 15,
      patternScore: 70,
      recentCandles,
      recentMacdHistogram: [-0.5, -0.2, 0.1],
      config,
    });
    expect(result.finalDecision).toBe('HOLD');
    expect(result.gateResults.reversal.status).toBe('rejected');
  });

  it('should return HOLD with neutral indicators', () => {
    const indicators = makeIndicators();
    const recentCandles = [makeCandle(100, 100), makeCandle(100, 100), makeCandle(100, 100)];
    const result = evaluateSignal({
      ticker: 'TEST',
      indicators,
      close: 100,
      open: 100,
      fearGreed: 50,
      patternScore: 0,
      recentCandles,
      recentMacdHistogram: [0, 0, 0],
      config,
    });
    expect(result.finalDecision).toBe('HOLD');
  });

  it('should bypass trend gate when disabled', () => {
    const noTrendConfig = {
      ...config,
      trendGate: { enabled: false, minConditions: 2, sidewaysThreshold: 2 },
    };
    const indicators = makeIndicators({
      rsi: 12,
      stochasticK: 8,
      williamsR: -92,
      bbLower: 100,
      bbUpper: 120,
      donchLower: 98,
      donchUpper: 125,
      sma20: 96,
      ema20: 96,
      sma50: 90,
      sma200: 110, // downtrend, but gate disabled
      volumeRatio: 1.5,
    });
    const recentCandles = [makeCandle(100, 95), makeCandle(95, 100), makeCandle(100, 98)];
    const result = evaluateSignal({
      ticker: 'TEST',
      indicators,
      close: 98,
      open: 100,
      fearGreed: 15,
      patternScore: 70,
      recentCandles,
      recentMacdHistogram: [-0.5, -0.2, 0.1],
      config: noTrendConfig,
    });
    // Should not be blocked by trend
    expect(result.gateResults.trend.passed).toBe(true);
  });
});
