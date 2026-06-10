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
      expect(candles[0]).toMatchObject({ close: 104, adjClose: 103.5, volume: 1_000_000 });
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
