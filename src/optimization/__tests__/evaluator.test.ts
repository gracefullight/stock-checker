import { describe, expect, it } from 'vitest';
import { type MatchedPrediction, type PredictionInput, calculateMetrics, matchPredictions } from '@/optimization/evaluator';

function makePrediction(overrides: Partial<PredictionInput> = {}): PredictionInput {
  return {
    Date: '2025-01-06',
    Ticker: 'AAPL',
    Result: 'Bullish',
    Opinion: 'BUY',
    Close: '100',
    ...overrides,
  };
}

function makeMatched(overrides: Partial<MatchedPrediction> = {}): MatchedPrediction {
  return {
    ...makePrediction(),
    futurePrice: 105,
    outcomeDate: '2025-01-13',
    change: 0.05,
    isCorrect: true,
    ...overrides,
  };
}

function buildPriceHistory(entries: Record<string, Record<string, number>>): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  for (const [ticker, dates] of Object.entries(entries)) {
    map.set(ticker, new Map(Object.entries(dates)));
  }
  return map;
}

describe('matchPredictions', () => {
  it('should skip HOLD predictions', () => {
    const predictions = [makePrediction({ Opinion: 'HOLD' })];
    const history = buildPriceHistory({ AAPL: { '2025-01-13': 105 } });

    const result = matchPredictions(predictions, history);

    expect(result).toHaveLength(0);
  });

  it('should skip tickers not in priceHistory', () => {
    const predictions = [makePrediction({ Ticker: 'MSFT' })];
    const history = buildPriceHistory({ AAPL: { '2025-01-13': 105 } });

    const result = matchPredictions(predictions, history);

    expect(result).toHaveLength(0);
  });

  it('should match BUY prediction as correct when price rises > 2%', () => {
    const predictions = [makePrediction({ Opinion: 'BUY', Close: '100' })];
    const history = buildPriceHistory({ AAPL: { '2025-01-11': 103 } });

    const result = matchPredictions(predictions, history, 5);

    expect(result).toHaveLength(1);
    expect(result[0].isCorrect).toBe(true);
    expect(result[0].change).toBeCloseTo(0.03);
  });

  it('should match SELL prediction as correct when price drops > 2%', () => {
    const predictions = [makePrediction({ Opinion: 'SELL', Close: '100' })];
    const history = buildPriceHistory({ AAPL: { '2025-01-11': 97 } });

    const result = matchPredictions(predictions, history, 5);

    expect(result).toHaveLength(1);
    expect(result[0].isCorrect).toBe(true);
    expect(result[0].change).toBeCloseTo(-0.03);
  });

  it('should mark BUY as incorrect when price does not rise > 2%', () => {
    const predictions = [makePrediction({ Opinion: 'BUY', Close: '100' })];
    const history = buildPriceHistory({ AAPL: { '2025-01-11': 101 } });

    const result = matchPredictions(predictions, history, 5);

    expect(result).toHaveLength(1);
    expect(result[0].isCorrect).toBe(false);
  });

  it('should look ahead from daysForward to daysForward+5 to find a matching date', () => {
    const predictions = [makePrediction({ Date: '2025-01-06', Opinion: 'BUY', Close: '100' })];
    // No price on day 5 (Jan 11), but available on day 8 (Jan 14)
    const history = buildPriceHistory({ AAPL: { '2025-01-14': 110 } });

    const result = matchPredictions(predictions, history, 5);

    expect(result).toHaveLength(1);
    expect(result[0].outcomeDate).toBe('2025-01-14');
    expect(result[0].futurePrice).toBe(110);
  });
});

describe('calculateMetrics', () => {
  it('should return all zeros for empty array', () => {
    const result = calculateMetrics([]);

    expect(result).toEqual({
      hitRate: 0,
      precision: 0,
      recall: 0,
      f1Score: 0,
      totalPredictions: 0,
      correctPredictions: 0,
    });
  });

  it('should calculate hitRate correctly', () => {
    const matched = [
      makeMatched({ isCorrect: true }),
      makeMatched({ isCorrect: true }),
      makeMatched({ isCorrect: false }),
      makeMatched({ isCorrect: false }),
    ];

    const result = calculateMetrics(matched);

    expect(result.hitRate).toBeCloseTo(50);
    expect(result.totalPredictions).toBe(4);
    expect(result.correctPredictions).toBe(2);
  });

  it('should calculate precision as TP / (TP + FP)', () => {
    const matched = [
      makeMatched({ Opinion: 'BUY', isCorrect: true }),  // TP
      makeMatched({ Opinion: 'BUY', isCorrect: false }), // FP
      makeMatched({ Opinion: 'BUY', isCorrect: false }), // FP
    ];

    const result = calculateMetrics(matched);

    // precision = 1 / (1 + 2) = 1/3
    expect(result.precision).toBeCloseTo(1 / 3);
  });

  it('should calculate recall as TP / (TP + FN)', () => {
    const matched = [
      makeMatched({ Opinion: 'BUY', isCorrect: true }),   // TP
      makeMatched({ Opinion: 'SELL', isCorrect: false }),  // FN
      makeMatched({ Opinion: 'SELL', isCorrect: false }),  // FN
    ];

    const result = calculateMetrics(matched);

    // recall = 1 / (1 + 2) = 1/3
    expect(result.recall).toBeCloseTo(1 / 3);
  });

  it('should calculate F1 score from precision and recall', () => {
    const matched = [
      makeMatched({ Opinion: 'BUY', isCorrect: true }),   // TP
      makeMatched({ Opinion: 'BUY', isCorrect: false }),   // FP
      makeMatched({ Opinion: 'SELL', isCorrect: false }),  // FN
      makeMatched({ Opinion: 'SELL', isCorrect: true }),   // TN
    ];

    const result = calculateMetrics(matched);

    // precision = 1 / (1 + 1) = 0.5
    // recall = 1 / (1 + 1) = 0.5
    // f1 = 2 * 0.5 * 0.5 / (0.5 + 0.5) = 0.5
    expect(result.precision).toBeCloseTo(0.5);
    expect(result.recall).toBeCloseTo(0.5);
    expect(result.f1Score).toBeCloseTo(0.5);
  });
});
