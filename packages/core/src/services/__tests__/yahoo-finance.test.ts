import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchYahooDaily } from '@/services/yahoo-finance';

const { chartMock } = vi.hoisted(() => ({ chartMock: vi.fn() }));

vi.mock('yahoo-finance2', () => ({
  default: class MockYahooFinance {
    chart = chartMock;
  },
}));

describe('fetchYahooDaily', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const bar = {
    date: new Date('2026-06-08T13:30:00Z'),
    open: 100,
    high: 110,
    low: 90,
    close: 100,
    adjclose: 100,
    volume: 1_000,
  };

  it.each([25, 98])('adjusts the entire OHLC candle to adjusted close %s', async (adjclose) => {
    chartMock.mockResolvedValueOnce({ quotes: [{ ...bar, adjclose }] });

    const [row] = await fetchYahooDaily('SPLIT', new Date('2026-01-01'), new Date('2026-06-10'));

    expect(row.open).toBe(adjclose);
    expect(row.high).toBeCloseTo(adjclose * 1.1);
    expect(row.low).toBeCloseTo(adjclose * 0.9);
    expect(row.close).toBe(adjclose);
    expect(row.adjClose).toBe(adjclose);
    expect(row.volume).toBe(1_000);
    expect(row.dollarVolume).toBe(100_000);
  });

  it('sorts sessions and emits one candle per trading date', async () => {
    chartMock.mockResolvedValueOnce({
      quotes: [
        { ...bar, date: new Date('2026-06-09T13:30:00Z'), close: 105, adjclose: 105 },
        bar,
        { ...bar, close: 101, adjclose: 101 },
      ],
    });

    const rows = await fetchYahooDaily('AAPL', new Date('2026-01-01'), new Date('2026-06-10'));

    expect(rows.map((r) => r.date.toISOString())).toEqual([
      '2026-06-08T00:00:00.000Z',
      '2026-06-09T00:00:00.000Z',
    ]);
    expect(rows[0].close).toBe(101);
  });

  it.each([
    { close: Number.NaN },
    { high: Number.POSITIVE_INFINITY },
    { low: 0 },
    { open: -1 },
    { high: 99 },
    { low: 101 },
    { adjclose: -1 },
    { volume: -1 },
    { volume: Number.POSITIVE_INFINITY },
    { volume: 1e308 },
    { date: new Date('invalid') },
  ])('rejects an invalid candle %j', async (invalid) => {
    chartMock.mockResolvedValueOnce({ quotes: [{ ...bar, ...invalid }] });

    await expect(
      fetchYahooDaily('BAD', new Date('2026-01-01'), new Date('2026-06-10'))
    ).resolves.toEqual([]);
  });

  it('excludes a non-null daily bar until its regular session closes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-09T17:00:00Z'));
    chartMock.mockResolvedValueOnce({
      meta: {
        exchangeTimezoneName: 'America/New_York',
        currentTradingPeriod: {
          regular: {
            start: new Date('2026-06-09T13:30:00Z'),
            end: new Date('2026-06-09T20:00:00Z'),
          },
        },
      },
      quotes: [bar, { ...bar, date: new Date('2026-06-09T13:30:00Z') }],
    });

    const rows = await fetchYahooDaily('AAPL', new Date('2026-01-01'), new Date('2026-06-10'));

    expect(rows).toHaveLength(1);
    expect(rows[0].date.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('uses the exchange trading date instead of the UTC timestamp date', async () => {
    chartMock.mockResolvedValueOnce({
      meta: { exchangeTimezoneName: 'Pacific/Auckland' },
      quotes: [{ ...bar, date: new Date('2026-06-08T22:00:00Z') }],
    });

    const [row] = await fetchYahooDaily('NZX', new Date('2026-01-01'), new Date('2026-06-10'));

    expect(row.date.toISOString()).toBe('2026-06-09T00:00:00.000Z');
  });

  it('accepts the completed current-session candle after the exchange close', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-09T20:01:00Z'));
    chartMock.mockResolvedValueOnce({
      meta: {
        exchangeTimezoneName: 'America/New_York',
        currentTradingPeriod: {
          regular: {
            start: new Date('2026-06-09T13:30:00Z'),
            end: new Date('2026-06-09T20:00:00Z'),
          },
        },
      },
      quotes: [{ ...bar, date: new Date('2026-06-09T13:30:00Z') }],
    });

    const rows = await fetchYahooDaily('AAPL', new Date('2026-01-01'), new Date('2026-06-10'));

    expect(rows).toHaveLength(1);
    expect(rows[0].date.toISOString()).toBe('2026-06-09T00:00:00.000Z');
  });

  it('rejects future candles even when their OHLC values are complete', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-09T20:01:00Z'));
    chartMock.mockResolvedValueOnce({
      quotes: [bar, { ...bar, date: new Date('2026-06-10T13:30:00Z') }],
    });

    const rows = await fetchYahooDaily('AAPL', new Date('2026-01-01'), new Date('2026-06-11'));

    expect(rows).toHaveLength(1);
    expect(rows[0].date.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('drops incomplete bars (null OHLC) instead of failing the whole fetch', async () => {
    chartMock.mockResolvedValueOnce({
      quotes: [
        {
          date: new Date('2026-06-08T13:30:00.000Z'),
          open: 396.33,
          high: 412.94,
          low: 394.72,
          close: 408.95,
          adjclose: 408.95,
          volume: 50_328_800,
        },
        // Yahoo appends the live in-progress bar with null close on trading days.
        {
          date: new Date('2026-06-09T13:30:00.000Z'),
          open: 411.03,
          high: 418.5,
          low: 384.24,
          close: null,
          adjclose: null,
          volume: 58_360_207,
        },
        {
          date: new Date('2026-06-05T13:30:00.000Z'),
          open: 420.5,
          high: 424.68,
          low: 388.59,
          close: 391,
          adjclose: null,
          volume: null,
        },
        {
          date: new Date('2026-06-04T13:30:00.000Z'),
          open: null,
          high: 424.68,
          low: 388.59,
          close: 392,
          adjclose: 392,
          volume: 1,
        },
      ],
    });

    const rows = await fetchYahooDaily('TSLA', new Date('2026-01-01'), new Date('2026-06-10'));

    expect(rows).toHaveLength(2);
    // adjclose falls back to close, null volume degrades to 0
    expect(rows[0]).toMatchObject({ close: 391, adjClose: 391, volume: 0 });
    expect(rows[1]).toMatchObject({ close: 408.95, adjClose: 408.95, volume: 50_328_800 });
    expect(rows.every((r) => r.close != null)).toBe(true);
  });

  it('propagates chart() failures to the caller', async () => {
    chartMock.mockRejectedValueOnce(new Error('rate limited'));

    await expect(
      fetchYahooDaily('TSLA', new Date('2026-01-01'), new Date('2026-06-10'))
    ).rejects.toThrow('rate limited');
  });
});
