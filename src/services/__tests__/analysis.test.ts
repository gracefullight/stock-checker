import { describe, expect, it } from 'vitest';
import { getOpinion } from '@/services/analysis';

describe('analysis', () => {
  it('should return BUY when buy score exceeds threshold', () => {
    const result = getOpinion({
      rsi: 25,
      stochasticK: 15,
      williamsR: -85,
      close: 100,
      bbLower: 102,
      bbUpper: 110,
      donchLower: 98,
      donchUpper: 105,
      fearGreed: 35,
      patternScore: 80,
    });

    expect(result.decision).toBe('BUY');
    expect(result.score).toBeGreaterThanOrEqual(200);
    expect(result.buyScore).toBe(435);
    expect(result.sellScore).toBe(0);
  });

  it('should return HOLD when no threshold met', () => {
    const result = getOpinion({
      rsi: 50,
      stochasticK: 50,
      williamsR: -50,
      close: 100,
      bbLower: 90,
      bbUpper: 110,
      donchLower: 90,
      donchUpper: 110,
      fearGreed: 50,
      patternScore: 0,
    });

    expect(result.decision).toBe('HOLD');
    expect(result.buyScore).toBe(0);
    expect(result.sellScore).toBe(0);
  });

  it('should return SELL when sell score exceeds threshold', () => {
    const result = getOpinion({
      rsi: 75,
      stochasticK: 85,
      williamsR: -10,
      close: 110,
      bbLower: 90,
      bbUpper: 110,
      donchLower: 90,
      donchUpper: 110,
      fearGreed: 65,
      patternScore: 0,
    });

    expect(result.decision).toBe('SELL');
    expect(result.sellScore).toBe(429);
    expect(result.score).toBe(429);
  });

  it('should have buyScore 0 when only sell indicators fire', () => {
    const result = getOpinion({
      rsi: 75,
      stochasticK: 85,
      williamsR: -10,
      close: 110,
      bbLower: 90,
      bbUpper: 110,
      donchLower: 90,
      donchUpper: 110,
      fearGreed: 65,
      patternScore: 0,
    });

    expect(result.buyScore).toBe(0);
    expect(result.sellScore).toBeGreaterThan(0);
  });

  it('should have sellScore 0 when only buy indicators fire', () => {
    const result = getOpinion({
      rsi: 25,
      stochasticK: 15,
      williamsR: -85,
      close: 100,
      bbLower: 102,
      bbUpper: 110,
      donchLower: 98,
      donchUpper: 105,
      fearGreed: 35,
      patternScore: 80,
    });

    expect(result.sellScore).toBe(0);
    expect(result.buyScore).toBeGreaterThan(0);
  });
});
