import { promises as fs } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addTicker, getWatchlist, removeTicker } from '@/watchlist/manager';

vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

describe('watchlist manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addTicker', () => {
    it('should add new ticker to watchlist', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ tickers: ['TSLA'], createdAt: '2026-01-01' })
      );
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await addTicker('PLTR');

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith('.watchlist.json', 'utf-8');
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        '.watchlist.json',
        JSON.stringify({ tickers: ['TSLA', 'PLTR'], createdAt: '2026-01-01' }, null, 2),
        'utf-8'
      );
    });

    it('should not add duplicate ticker', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ tickers: ['TSLA'], createdAt: '2026-01-01' })
      );
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await addTicker('TSLA');

      expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    });
  });

  describe('removeTicker', () => {
    it('should remove ticker from watchlist', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ tickers: ['TSLA', 'PLTR'], createdAt: '2026-01-01' })
      );
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await removeTicker('PLTR');

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        '.watchlist.json',
        JSON.stringify({ tickers: ['TSLA'], createdAt: '2026-01-01' }, null, 2),
        'utf-8'
      );
    });

    it('should not write when ticker not found', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ tickers: ['TSLA'], createdAt: '2026-01-01' })
      );
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await removeTicker('AAPL');

      expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    });
  });

  describe('getWatchlist', () => {
    it('should return empty watchlist when file is missing', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const watchlist = await getWatchlist();

      expect(watchlist.tickers).toEqual([]);
      expect(watchlist.createdAt).toBeTruthy();
    });
  });
});
