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

  describe('persistence failures', () => {
    it.each(['EACCES', 'EIO'])(
      'does not overwrite a watchlist after a %s read failure',
      async (code) => {
        const error = Object.assign(new Error('Failed to read watchlist'), { code });
        vi.mocked(fs.readFile).mockRejectedValueOnce(error);

        await expect(addTicker('PLTR')).rejects.toBe(error);

        expect(fs.writeFile).not.toHaveBeenCalled();
      }
    );

    it('does not overwrite malformed watchlist JSON', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce('{"tickers":');

      await expect(addTicker('PLTR')).rejects.toBeInstanceOf(SyntaxError);

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it.each([
      { action: 'add', mutate: () => addTicker('PLTR') },
      { action: 'remove', mutate: () => removeTicker('TSLA') },
    ])('reports a failed $action when saving fails', async ({ mutate }) => {
      const error = Object.assign(new Error('Failed to write watchlist'), { code: 'ENOSPC' });
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({ tickers: ['TSLA'], createdAt: '2026-01-01' })
      );
      vi.mocked(fs.writeFile).mockRejectedValueOnce(error);

      await expect(mutate()).rejects.toBe(error);
    });
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
      vi.mocked(fs.readFile).mockRejectedValueOnce(
        Object.assign(new Error('File not found'), { code: 'ENOENT' })
      );

      const watchlist = await getWatchlist();

      expect(watchlist.tickers).toEqual([]);
      expect(watchlist.createdAt).toBeTruthy();
    });
  });
});
