import { describe, expect, it, vi } from 'vitest';
import { matchPredictions, type PredictionInput } from '@/optimization/evaluator';
import { loadPredictionPriceHistory } from '@/optimization/prediction-history';

vi.mock('@/services/data-fetcher', () => ({ getHistoricalPrices: vi.fn() }));

function prediction(overrides: Partial<PredictionInput> = {}): PredictionInput {
  return {
    Date: '2025-01-06',
    Ticker: 'AAPL',
    Result: 'Bullish',
    Opinion: 'BUY',
    Close: '200',
    Score: 100,
    ...overrides,
  };
}

function row(date: string, close = 100, adjClose = close) {
  return { date: new Date(`${date}T00:00:00.000Z`), close, adjClose };
}

const now = new Date('2025-01-14T12:00:00.000Z');

describe('loadPredictionPriceHistory', () => {
  it('requests each BUY/SELL ticker once using its earliest valid forecast date through now', async () => {
    const fetchPrices = vi.fn().mockResolvedValue([row('2025-01-06'), row('2025-01-10')]);

    await loadPredictionPriceHistory(
      [
        prediction(),
        prediction({ Date: '2025-01-10', Opinion: 'SELL' }),
        prediction({ Ticker: 'MSFT', Date: '2025-01-10' }),
        prediction({ Ticker: 'HOLD_ONLY', Opinion: 'HOLD' }),
        prediction({ Ticker: 'INVALID', Date: 'not-a-date' }),
        prediction({ Ticker: 'FUTURE', Date: '2025-01-15' }),
        prediction({ Ticker: '' }),
      ],
      { now, fetchPrices }
    );

    expect(fetchPrices).toHaveBeenCalledTimes(2);
    expect(fetchPrices).toHaveBeenCalledWith('AAPL', 9);
    expect(fetchPrices).toHaveBeenCalledWith('MSFT', 5);
  });

  it('uses full daily provider sessions despite sparse forecasts and raw archive closes', async () => {
    const predictions = [prediction(), prediction({ Date: '2025-01-13', Opinion: 'SELL' })];
    const fetchPrices = vi
      .fn()
      .mockResolvedValue([
        row('2025-01-06', 200, 100),
        row('2025-01-07', 200, 100),
        row('2025-01-08', 200, 100),
        row('2025-01-09', 200, 100),
        row('2025-01-10', 200, 100),
        row('2025-01-13', 100, 100),
        row('2025-01-14', 100, 100),
      ]);

    const { priceHistory } = await loadPredictionPriceHistory(predictions, { now, fetchPrices });
    const matched = matchPredictions(predictions, priceHistory);

    expect(fetchPrices).toHaveBeenCalledOnce();
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ outcomeDate: '2025-01-13', change: 0, isCorrect: false });
  });

  it('bounds concurrent network requests to two', async () => {
    type Rows = ReturnType<typeof row>[];
    const pending = new Map<string, (rows: Rows) => void>();
    let active = 0;
    let maximumActive = 0;
    const fetchPrices = vi.fn((ticker: string) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      return new Promise<Rows>((resolve) => {
        pending.set(ticker, (rows) => {
          active--;
          resolve(rows);
        });
      });
    });
    const loading = loadPredictionPriceHistory(
      ['AAPL', 'MSFT', 'GOOGL', 'TSLA'].map((Ticker) => prediction({ Ticker })),
      { now, fetchPrices }
    );
    expect(fetchPrices).toHaveBeenCalledTimes(2);

    pending.get('AAPL')?.([row('2025-01-06')]);
    await vi.waitFor(() => expect(fetchPrices).toHaveBeenCalledTimes(3));
    pending.get('MSFT')?.([row('2025-01-06')]);
    await vi.waitFor(() => expect(fetchPrices).toHaveBeenCalledTimes(4));
    pending.get('GOOGL')?.([row('2025-01-06')]);
    pending.get('TSLA')?.([row('2025-01-06')]);
    await loading;

    expect(maximumActive).toBe(2);
  });

  it('excludes failed and empty series without retries or CSV price fallback', async () => {
    const fetchPrices = vi.fn(async (ticker: string) => {
      if (ticker === 'AAPL') throw new Error('Provider unavailable');
      return [];
    });
    const predictions = [prediction(), prediction({ Ticker: 'MSFT' })];

    const { priceHistory, diagnostics } = await loadPredictionPriceHistory(predictions, {
      now,
      fetchPrices,
    });

    expect(fetchPrices).toHaveBeenCalledTimes(2);
    expect(priceHistory.size).toBe(0);
    expect(matchPredictions(predictions, priceHistory)).toEqual([]);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        { ticker: 'AAPL', reason: 'fetch-failed' },
        { ticker: 'MSFT', reason: 'empty-history' },
      ])
    );
  });

  it('retains an invalid endpoint date instead of moving the fifth-session outcome', async () => {
    const fetchPrices = vi
      .fn()
      .mockResolvedValue([
        row('2025-01-06'),
        row('2025-01-07'),
        row('2025-01-08'),
        row('2025-01-09'),
        row('2025-01-10'),
        row('2025-01-13', 100, Number.NaN),
        row('2025-01-14', 105),
      ]);

    const { priceHistory } = await loadPredictionPriceHistory([prediction()], { now, fetchPrices });

    expect(matchPredictions([prediction()], priceHistory)).toEqual([]);
  });

  it('excludes dates outside the forecast-to-now window and invalid provider dates', async () => {
    const fetchPrices = vi
      .fn()
      .mockResolvedValue([
        row('2025-01-03'),
        row('2025-01-06'),
        row('2025-01-15'),
        { date: new Date(Number.NaN), close: 100 },
      ]);

    const { priceHistory } = await loadPredictionPriceHistory([prediction()], { now, fetchPrices });

    expect([...(priceHistory.get('AAPL')?.keys() ?? [])]).toEqual(['2025-01-06']);
  });
});
