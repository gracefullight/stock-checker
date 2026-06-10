import { describe, expect, it, vi } from 'vitest';
import { fetchYahooDaily } from '@/services/yahoo-finance';

const { chartMock } = vi.hoisted(() => ({ chartMock: vi.fn() }));

vi.mock('yahoo-finance2', () => ({
  default: class MockYahooFinance {
    chart = chartMock;
  },
}));

describe('fetchYahooDaily', () => {
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
    expect(rows[0]).toMatchObject({ close: 408.95, adjClose: 408.95, volume: 50_328_800 });
    // adjclose falls back to close, null volume degrades to 0
    expect(rows[1]).toMatchObject({ close: 391, adjClose: 391, volume: 0 });
    expect(rows.every((r) => r.close != null)).toBe(true);
  });

  it('propagates chart() failures to the caller', async () => {
    chartMock.mockRejectedValueOnce(new Error('rate limited'));

    await expect(
      fetchYahooDaily('TSLA', new Date('2026-01-01'), new Date('2026-06-10'))
    ).rejects.toThrow('rate limited');
  });
});
