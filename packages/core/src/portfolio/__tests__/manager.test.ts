import { promises as fs } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_STORE_ROOT, legacyStorePaths } from '@/portfolio/local-store';
import {
  addAsset,
  generatePerformanceReport,
  getPortfolio,
  PORTFOLIO_FILE,
  removeAsset,
} from '@/portfolio/manager';
import type { TickerResult } from '@/types';

vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

const missing = () => Object.assign(new Error('File not found'), { code: 'ENOENT' });

/** Serves the shared store from `saved` and every legacy location from `legacy`. */
function storeFiles(saved: unknown | null, legacy: Record<string, unknown> = {}) {
  vi.mocked(fs.readFile).mockImplementation(async (file) => {
    const key = String(file);
    if (key === PORTFOLIO_FILE) {
      if (saved === null) throw missing();
      return JSON.stringify(saved);
    }
    if (key in legacy) return JSON.stringify(legacy[key]);
    throw missing();
  });
}

describe('portfolio manager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
  });

  describe('store location', () => {
    it('anchors the store under the repository data directory, not the working directory', () => {
      expect(PORTFOLIO_FILE).toBe(path.join(LOCAL_STORE_ROOT, 'portfolio.json'));
      expect(path.isAbsolute(PORTFOLIO_FILE)).toBe(true);
      expect(PORTFOLIO_FILE).toMatch(/[\\/]data[\\/]portfolio\.json$/);
      expect(PORTFOLIO_FILE).not.toContain(path.join('packages', 'core', 'data'));
    });

    it('lists the legacy API and CLI working-directory files for migration', () => {
      const legacy = legacyStorePaths('.portfolio.json');
      expect(legacy).toContain(path.join(LOCAL_STORE_ROOT, '..', 'apps', 'api', '.portfolio.json'));
      expect(legacy).toContain(
        path.join(LOCAL_STORE_ROOT, '..', 'packages', 'core', '.portfolio.json')
      );
      expect(new Set(legacy).size).toBe(legacy.length);
    });
  });

  describe('legacy migration', () => {
    it('merges the API and CLI files once into the shared store and keeps the earliest createdAt', async () => {
      const [apiFile, cliFile] = legacyStorePaths('.portfolio.json');
      storeFiles(null, {
        [apiFile]: { assets: ['TSLA', 'NVDA', 'AAPL'], createdAt: '2026-06-09T09:13:17.171Z' },
        [cliFile]: { assets: ['tsla', 'PLTR'], createdAt: '2026-01-24T11:17:46.824Z' },
      });

      const portfolio = await getPortfolio();

      expect(portfolio).toEqual({
        assets: ['TSLA', 'NVDA', 'AAPL', 'PLTR'],
        createdAt: '2026-01-24T11:17:46.824Z',
      });
      expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(PORTFOLIO_FILE), { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledExactlyOnceWith(
        PORTFOLIO_FILE,
        JSON.stringify(portfolio, null, 2),
        'utf-8'
      );
    });

    it('prefers the shared store over legacy files once it exists', async () => {
      const [apiFile] = legacyStorePaths('.portfolio.json');
      storeFiles(
        { assets: ['MSFT'], createdAt: '2026-07-01' },
        { [apiFile]: { assets: ['TSLA'], createdAt: '2026-06-09' } }
      );

      const portfolio = await getPortfolio();

      expect(portfolio.assets).toEqual(['MSFT']);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('creates an empty portfolio only when neither the store nor legacy files exist', async () => {
      storeFiles(null);

      const portfolio = await getPortfolio();

      expect(portfolio.assets).toEqual([]);
      expect(portfolio.createdAt).toBeTruthy();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('persistence failures', () => {
    it.each(['EACCES', 'EIO'])(
      'does not overwrite a portfolio after a %s read failure',
      async (code) => {
        const error = Object.assign(new Error('Failed to read portfolio'), { code });
        vi.mocked(fs.readFile).mockRejectedValueOnce(error);

        await expect(addAsset('PLTR')).rejects.toBe(error);

        expect(fs.writeFile).not.toHaveBeenCalled();
      }
    );

    it('does not overwrite malformed portfolio JSON', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce('{"assets":');

      await expect(addAsset('PLTR')).rejects.toBeInstanceOf(SyntaxError);

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it.each([
      { action: 'add', mutate: () => addAsset('PLTR') },
      { action: 'remove', mutate: () => removeAsset('TSLA') },
    ])('reports a failed $action when saving fails', async ({ mutate }) => {
      const error = Object.assign(new Error('Failed to write portfolio'), { code: 'ENOSPC' });
      storeFiles({ assets: ['TSLA'], createdAt: '2026-01-01' });
      vi.mocked(fs.writeFile).mockRejectedValueOnce(error);

      await expect(mutate()).rejects.toBe(error);
    });
  });

  describe('addAsset', () => {
    it('should add new asset to portfolio', async () => {
      storeFiles({ assets: ['TSLA'], createdAt: '2026-01-01' });

      await addAsset('PLTR');

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith(PORTFOLIO_FILE, 'utf-8');
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        PORTFOLIO_FILE,
        JSON.stringify({ assets: ['TSLA', 'PLTR'], createdAt: '2026-01-01' }, null, 2),
        'utf-8'
      );
    });

    it('should not add duplicate asset', async () => {
      storeFiles({ assets: ['TSLA'], createdAt: '2026-01-01' });

      await addAsset('TSLA');

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith(PORTFOLIO_FILE, 'utf-8');
      expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    });
  });

  describe('removeAsset', () => {
    it('should remove asset from portfolio', async () => {
      storeFiles({ assets: ['TSLA', 'PLTR'], createdAt: '2026-01-01' });

      await removeAsset('PLTR');

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith(PORTFOLIO_FILE, 'utf-8');
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        PORTFOLIO_FILE,
        JSON.stringify({ assets: ['TSLA'], createdAt: '2026-01-01' }, null, 2),
        'utf-8'
      );
    });

    it('should warn if asset not found', async () => {
      storeFiles({ assets: ['TSLA'], createdAt: '2026-01-01' });

      await removeAsset('AAPL');

      expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    });
  });

  describe('generatePerformanceReport', () => {
    const result = (ticker: string, opinion: string, close: number): TickerResult => ({
      ticker,
      date: '2026-01-24',
      close,
      volume: 1000000,
      rsi: 50,
      stochasticK: 50,
      bbLower: 190,
      bbUpper: 210,
      donchLower: 185,
      donchUpper: 215,
      williamsR: -50,
      fearGreed: 50,
      patterns: [],
      score: 100,
      opinion,
      atr: 5,
      stopLoss: 195,
      takeProfit: 205,
      trailingStop: 195,
      trailingStart: 202.5,
      macd: 0,
      macdSignal: 0,
      macdHistogram: 0,
      sma20: 195,
      ema20: 195,
    });

    it('should generate markdown report for portfolio tickers', async () => {
      const report = await generatePerformanceReport(
        ['TSLA', 'PLTR'],
        [result('TSLA', 'HOLD', 200), result('PLTR', 'BUY', 25)]
      );

      expect(report).toContain('# Portfolio Performance Report');
      expect(report).toContain('## TSLA');
      expect(report).toContain('## PLTR');
      expect(report).toContain('- Session: 2026-01-24');
      expect(report).toContain('Generated:');
      expect(report).not.toContain('Unavailable');
    });

    it('names tickers without a usable analysis instead of dropping them silently', async () => {
      const report = await generatePerformanceReport(
        ['TSLA', 'BAD'],
        [result('TSLA', 'HOLD', 200)]
      );

      expect(report).toContain('Unavailable (no usable analysis): BAD');
      expect(report).toContain('## TSLA');
      expect(report).not.toContain('## BAD');
    });
  });
});
