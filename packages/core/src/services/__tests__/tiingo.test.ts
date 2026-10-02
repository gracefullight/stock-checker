import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTiingoConfigured, mapTiingoRows } from '@/services/tiingo';

describe('tiingo', () => {
  const originalKey = process.env.TIINGO_API_KEY;

  beforeEach(() => {
    delete process.env.TIINGO_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.TIINGO_API_KEY;
    else process.env.TIINGO_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  describe('isTiingoConfigured', () => {
    it('reflects TIINGO_API_KEY presence', () => {
      expect(isTiingoConfigured()).toBe(false);
      process.env.TIINGO_API_KEY = 'test-key';
      expect(isTiingoConfigured()).toBe(true);
    });
  });

  describe('mapTiingoRows', () => {
    const bar = {
      date: '2026-06-09T00:00:00Z',
      open: 400,
      high: 440,
      low: 360,
      close: 400,
      adjOpen: 100,
      adjHigh: 110,
      adjLow: 90,
      adjClose: 100,
      volume: 100,
      adjVolume: 400,
    };

    it('uses adjusted OHLC and share volume across a split', () => {
      const [row] = mapTiingoRows([bar]);

      expect(row).toMatchObject({
        open: 100,
        high: 110,
        low: 90,
        close: 100,
        adjClose: 100,
        volume: 400,
      });
    });

    it('scales missing adjusted range fields using the adjusted-close ratio', () => {
      const [row] = mapTiingoRows([
        { ...bar, adjOpen: undefined, adjHigh: undefined, adjLow: undefined },
      ]);

      expect(row).toMatchObject({ open: 100, high: 110, low: 90, close: 100 });
    });

    it('uses coherent raw OHLC and volume when adjusted close is absent', () => {
      const [row] = mapTiingoRows([{ ...bar, adjClose: undefined }]);

      expect(row).toMatchObject({
        open: 400,
        high: 440,
        low: 360,
        close: 400,
        adjClose: 400,
        volume: 100,
      });
    });

    it('preserves nominal dollar turnover across dividend adjustment', () => {
      const [row] = mapTiingoRows([
        {
          ...bar,
          adjOpen: 98,
          adjHigh: 107.8,
          adjLow: 88.2,
          adjClose: 98,
        },
      ]);

      expect(row.close).toBe(98);
      expect(row.volume).toBe(400);
      expect(row.dollarVolume).toBe(40_000);
    });

    it.each([
      { date: 'invalid' },
      { close: Number.NaN },
      { high: Number.POSITIVE_INFINITY, adjHigh: undefined },
      { adjClose: 0 },
      { adjHigh: 99 },
      { adjLow: 101 },
      { adjVolume: -1 },
      { adjVolume: Number.POSITIVE_INFINITY },
      { volume: -1 },
      { volume: Number.POSITIVE_INFINITY },
    ])('rejects an invalid candle %j', (invalid) => {
      expect(mapTiingoRows([{ ...bar, ...invalid }])).toEqual([]);
    });

    it('sorts and deduplicates daily sessions', () => {
      const rows = mapTiingoRows([{ ...bar, date: '2026-06-10' }, bar, { ...bar, adjClose: 101 }]);

      expect(rows.map((r) => r.date.toISOString())).toEqual([
        '2026-06-09T00:00:00.000Z',
        '2026-06-10T00:00:00.000Z',
      ]);
      expect(rows[0].close).toBe(101);
    });

    it('maps raw rows to candles with adjClose fallback', () => {
      const candles = mapTiingoRows([
        {
          date: '2026-06-09T00:00:00.000Z',
          open: 100,
          high: 105,
          low: 99,
          close: 104,
          adjClose: 103.5,
          volume: 1_000_000,
        },
        {
          date: '2026-06-10T00:00:00.000Z',
          open: 104,
          high: 106,
          low: 103,
          close: 105,
          volume: 900_000,
        },
      ]);

      expect(candles).toHaveLength(2);
      expect(candles[0]).toMatchObject({ close: 103.5, adjClose: 103.5, volume: 1_000_000 });
      expect(candles[0].date).toBeInstanceOf(Date);
      // adjClose falls back to close when missing
      expect(candles[1].adjClose).toBe(105);
    });

    it('drops rows without a close or date', () => {
      const candles = mapTiingoRows([
        { date: '', open: 1, high: 1, low: 1, close: 1, volume: 1 },
        {
          date: '2026-06-09',
          open: 1,
          high: 1,
          low: 1,
          close: null as unknown as number,
          volume: 1,
        },
        { date: '2026-06-10', open: 2, high: 2, low: 2, close: 2, volume: 2 },
      ]);

      expect(candles).toHaveLength(1);
      expect(candles[0].close).toBe(2);
    });
  });
});
