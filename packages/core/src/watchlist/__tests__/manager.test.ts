import { promises as fs } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_STORE_ROOT, legacyStorePaths } from '@/portfolio/local-store';
import { addTicker, getWatchlist, removeTicker, WATCHLIST_FILE } from '@/watchlist/manager';

vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

const missing = () => Object.assign(new Error('File not found'), { code: 'ENOENT' });

function storeFiles(saved: unknown | null, legacy: Record<string, unknown> = {}) {
  vi.mocked(fs.readFile).mockImplementation(async (file) => {
    const key = String(file);
    if (key === WATCHLIST_FILE) {
      if (saved === null) throw missing();
      return JSON.stringify(saved);
    }
    if (key in legacy) return JSON.stringify(legacy[key]);
    throw missing();
  });
}

describe('watchlist manager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
  });

  it('anchors the store next to the portfolio under the repository data directory', () => {
    expect(WATCHLIST_FILE).toBe(path.join(LOCAL_STORE_ROOT, 'watchlist.json'));
    expect(path.isAbsolute(WATCHLIST_FILE)).toBe(true);
  });

  it('migrates legacy working-directory watchlists once and leaves them in place', async () => {
    const [apiFile, cliFile] = legacyStorePaths('.watchlist.json');
    storeFiles(null, {
      [apiFile]: { tickers: ['AAPL'], createdAt: '2026-06-01' },
      [cliFile]: { tickers: ['aapl', 'PLTR'], createdAt: '2026-02-01' },
    });

    const watchlist = await getWatchlist();

    expect(watchlist).toEqual({ tickers: ['AAPL', 'PLTR'], createdAt: '2026-02-01' });
    expect(fs.writeFile).toHaveBeenCalledExactlyOnceWith(
      WATCHLIST_FILE,
      JSON.stringify(watchlist, null, 2),
      'utf-8'
    );
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
      storeFiles({ tickers: ['TSLA'], createdAt: '2026-01-01' });
      vi.mocked(fs.writeFile).mockRejectedValueOnce(error);

      await expect(mutate()).rejects.toBe(error);
    });
  });

  describe('addTicker', () => {
    it('should add new ticker to watchlist', async () => {
      storeFiles({ tickers: ['TSLA'], createdAt: '2026-01-01' });

      await addTicker('PLTR');

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith(WATCHLIST_FILE, 'utf-8');
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        WATCHLIST_FILE,
        JSON.stringify({ tickers: ['TSLA', 'PLTR'], createdAt: '2026-01-01' }, null, 2),
        'utf-8'
      );
    });

    it('should not add duplicate ticker', async () => {
      storeFiles({ tickers: ['TSLA'], createdAt: '2026-01-01' });

      await addTicker('TSLA');

      expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    });
  });

  describe('removeTicker', () => {
    it('should remove ticker from watchlist', async () => {
      storeFiles({ tickers: ['TSLA', 'PLTR'], createdAt: '2026-01-01' });

      await removeTicker('PLTR');

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        WATCHLIST_FILE,
        JSON.stringify({ tickers: ['TSLA'], createdAt: '2026-01-01' }, null, 2),
        'utf-8'
      );
    });

    it('should not write when ticker not found', async () => {
      storeFiles({ tickers: ['TSLA'], createdAt: '2026-01-01' });

      await removeTicker('AAPL');

      expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    });
  });

  describe('getWatchlist', () => {
    it('should return empty watchlist when no store or legacy file exists', async () => {
      storeFiles(null);

      const watchlist = await getWatchlist();

      expect(watchlist.tickers).toEqual([]);
      expect(watchlist.createdAt).toBeTruthy();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });
});
