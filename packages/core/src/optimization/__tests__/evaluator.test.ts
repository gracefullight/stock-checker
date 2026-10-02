import { describe, expect, it } from 'vitest';
import {
  calculateMetrics,
  type MatchedPrediction,
  matchPredictions,
  type PredictionInput,
} from '@/optimization/evaluator';

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

function buildPriceHistory(
  entries: Record<string, Record<string, number>>
): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  for (const [ticker, dates] of Object.entries(entries)) {
    map.set(ticker, new Map(Object.entries(dates)));
  }
  return map;
}

function fiveSessionHistory(outcomePrice: number, entryPrice = 100) {
  return buildPriceHistory({
    AAPL: {
      '2025-01-06': entryPrice,
      '2025-01-07': 100,
      '2025-01-08': 100,
      '2025-01-09': 100,
      '2025-01-10': 100,
      '2025-01-13': outcomePrice,
    },
  });
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
    const history = fiveSessionHistory(103);

    const result = matchPredictions(predictions, history, 5);

    expect(result).toHaveLength(1);
    expect(result[0].isCorrect).toBe(true);
    expect(result[0].change).toBeCloseTo(0.03);
  });

  it('should match SELL prediction as correct when price drops > 2%', () => {
    const predictions = [makePrediction({ Opinion: 'SELL', Close: '100' })];
    const history = fiveSessionHistory(97);

    const result = matchPredictions(predictions, history, 5);

    expect(result).toHaveLength(1);
    expect(result[0].isCorrect).toBe(true);
    expect(result[0].change).toBeCloseTo(-0.03);
  });

  it('should mark BUY as incorrect when price does not rise > 2%', () => {
    const predictions = [makePrediction({ Opinion: 'BUY', Close: '100' })];
    const history = fiveSessionHistory(101);

    const result = matchPredictions(predictions, history, 5);

    expect(result).toHaveLength(1);
    expect(result[0].isCorrect).toBe(false);
  });

  it('uses the fifth subsequent observed session across a holiday gap and unordered rows', () => {
    const predictions = [makePrediction({ Date: '2025-01-17' })];
    const history = buildPriceHistory({
      AAPL: {
        '2025-01-27': 110,
        '2025-01-23': 104,
        '2025-01-17': 100,
        '2025-01-24': 108,
        '2025-01-22': 103,
        '2025-01-21': 101,
      },
    });

    const result = matchPredictions(predictions, history, 5);

    expect(result).toHaveLength(1);
    expect(result[0].outcomeDate).toBe('2025-01-27');
    expect(result[0].futurePrice).toBe(110);
  });

  it('uses an adjusted historical entry instead of the raw CSV close across a split', () => {
    const predictions = [makePrediction({ Opinion: 'SELL', Close: '200' })];

    const result = matchPredictions(predictions, fiveSessionHistory(100, 100));

    expect(result).toHaveLength(1);
    expect(result[0].change).toBe(0);
    expect(result[0].isCorrect).toBe(false);
  });

  it('uses the same adjusted basis across a dividend adjustment', () => {
    const predictions = [makePrediction({ Close: '100' })];

    const result = matchPredictions(predictions, fiveSessionHistory(99, 97));

    expect(result).toHaveLength(1);
    expect(result[0].change).toBeCloseTo(2 / 97);
    expect(result[0].isCorrect).toBe(true);
  });

  it('does not fall back to the CSV close when the historical entry is absent', () => {
    const history = fiveSessionHistory(105);
    history.get('AAPL')?.delete('2025-01-06');

    expect(matchPredictions([makePrediction()], history)).toEqual([]);
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('skips an invalid historical entry price %s', (entryPrice) => {
    expect(matchPredictions([makePrediction()], fiveSessionHistory(105, entryPrice))).toEqual([]);
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('skips an invalid fifth-session outcome %s without substituting a later price', (outcomePrice) => {
    const history = fiveSessionHistory(outcomePrice);
    history.get('AAPL')?.set('2025-01-14', 105);

    expect(matchPredictions([makePrediction()], history)).toEqual([]);
  });

  it('skips a prediction without five subsequent observed sessions', () => {
    const history = fiveSessionHistory(105);
    history.get('AAPL')?.delete('2025-01-13');

    expect(matchPredictions([makePrediction()], history)).toEqual([]);
  });

  it('excludes invalid historical date rows from the observed session count', () => {
    const history = fiveSessionHistory(105);
    history.get('AAPL')?.set('2025-01-12-invalid', 999);

    const result = matchPredictions([makePrediction()], history);

    expect(result).toHaveLength(1);
    expect(result[0].outcomeDate).toBe('2025-01-13');
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
      makeMatched({ Opinion: 'BUY', isCorrect: true }), // TP
      makeMatched({ Opinion: 'BUY', isCorrect: false }), // FP
      makeMatched({ Opinion: 'BUY', isCorrect: false }), // FP
    ];

    const result = calculateMetrics(matched);

    // precision = 1 / (1 + 2) = 1/3
    expect(result.precision).toBeCloseTo(1 / 3);
  });

  it('should calculate recall as TP / (TP + FN)', () => {
    const matched = [
      makeMatched({ Opinion: 'BUY', isCorrect: true }), // TP
      makeMatched({ Opinion: 'SELL', isCorrect: false }), // FN
      makeMatched({ Opinion: 'SELL', isCorrect: false }), // FN
    ];

    const result = calculateMetrics(matched);

    // recall = 1 / (1 + 2) = 1/3
    expect(result.recall).toBeCloseTo(1 / 3);
  });

  it('should calculate F1 score from precision and recall', () => {
    const matched = [
      makeMatched({ Opinion: 'BUY', isCorrect: true }), // TP
      makeMatched({ Opinion: 'BUY', isCorrect: false }), // FP
      makeMatched({ Opinion: 'SELL', isCorrect: false }), // FN
      makeMatched({ Opinion: 'SELL', change: -0.05, isCorrect: true }), // TN
    ];

    const result = calculateMetrics(matched);

    // precision = 1 / (1 + 1) = 0.5
    // recall = 1 / (1 + 1) = 0.5
    // f1 = 2 * 0.5 * 0.5 / (0.5 + 0.5) = 0.5
    expect(result.precision).toBeCloseTo(0.5);
    expect(result.recall).toBeCloseTo(0.5);
    expect(result.f1Score).toBeCloseTo(0.5);
  });

  it('does not count a neutral or small down move as a missed positive BUY outcome', () => {
    const matched = [
      makeMatched({ Opinion: 'BUY', change: 0.05, isCorrect: true }),
      makeMatched({ Opinion: 'SELL', change: 0.05, isCorrect: false }),
      makeMatched({ Opinion: 'SELL', change: 0.01, isCorrect: false }),
      makeMatched({ Opinion: 'SELL', change: -0.01, isCorrect: false }),
    ];

    expect(calculateMetrics(matched).recall).toBe(0.5);
  });
});
