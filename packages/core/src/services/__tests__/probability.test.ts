import { describe, expect, it } from 'vitest';

import {
  calculateProbabilities,
  fitCalibration,
  getDecisionFromProbabilities,
} from '@/services/probability';

describe('calculateProbabilities', () => {
  it('should sum probabilities to ~100%', () => {
    const result = calculateProbabilities(100, 50);
    const sum = result.buyProbability + result.sellProbability + result.holdProbability;
    expect(sum).toBeCloseTo(100, 0);
  });

  it('should have buyProbability > sellProbability when buyScore >> sellScore', () => {
    const result = calculateProbabilities(200, 10);
    expect(result.buyProbability).toBeGreaterThan(result.sellProbability);
  });

  it('should have sellProbability > buyProbability when sellScore >> buyScore', () => {
    const result = calculateProbabilities(10, 200);
    expect(result.sellProbability).toBeGreaterThan(result.buyProbability);
  });

  it('should have equal buy and sell probabilities when scores are equal', () => {
    const result = calculateProbabilities(100, 100);
    expect(result.buyProbability).toBe(result.sellProbability);
  });

  it('should return confidence "very-high" when maxProb >= 75', () => {
    const result = calculateProbabilities(500, 0);
    expect(result.confidence).toBe('very-high');
  });

  it('should return confidence "high" when maxProb >= 60 and < 75', () => {
    const result = calculateProbabilities(150, 50);
    expect(result.confidence).toBe('high');
  });

  it('should return confidence "medium" when maxProb >= 40 and < 60', () => {
    const result = calculateProbabilities(100, 100);
    expect(result.confidence).toBe('medium');
  });

  it('should return confidence "low" when maxProb < 40', () => {
    const result = calculateProbabilities(0, 0);
    expect(result.confidence).toBe('low');
  });

  it('should change output with custom calibration params', () => {
    const defaultResult = calculateProbabilities(100, 50);
    const customResult = calculateProbabilities(100, 50, { slope: 0.05, intercept: -2.0 });
    expect(customResult.buyProbability).not.toBe(defaultResult.buyProbability);
  });
});

describe('fitCalibration', () => {
  it('should return defaults for empty arrays', () => {
    const result = fitCalibration([], []);
    expect(result).toEqual({ slope: 0.01, intercept: -1.0 });
  });

  it('should return valid slope and intercept for non-empty data', () => {
    const scores = [50, 100, 150, 200];
    const outcomes = [0, 0, 1, 1];
    const result = fitCalibration(scores, outcomes);
    expect(result).toHaveProperty('slope');
    expect(result).toHaveProperty('intercept');
    expect(typeof result.slope).toBe('number');
    expect(typeof result.intercept).toBe('number');
  });
});

describe('getDecisionFromProbabilities', () => {
  it('should return "BUY" when buyProbability is highest', () => {
    const decision = getDecisionFromProbabilities({
      buyProbability: 60,
      sellProbability: 20,
      holdProbability: 20,
      confidence: 'high',
    });
    expect(decision).toBe('BUY');
  });

  it('should return "SELL" when sellProbability is highest', () => {
    const decision = getDecisionFromProbabilities({
      buyProbability: 20,
      sellProbability: 60,
      holdProbability: 20,
      confidence: 'high',
    });
    expect(decision).toBe('SELL');
  });

  it('should return "HOLD" when holdProbability is highest', () => {
    const decision = getDecisionFromProbabilities({
      buyProbability: 20,
      sellProbability: 20,
      holdProbability: 60,
      confidence: 'high',
    });
    expect(decision).toBe('HOLD');
  });
});
