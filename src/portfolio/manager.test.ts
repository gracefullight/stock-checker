import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addAsset, removeAsset, getPortfolio, generatePerformanceReport } from './manager';
import type { TickerResult } from '../types';

vi.mock('node:fs/promises');

describe('portfolio manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addAsset', () => {
    it('should add new asset to portfolio', async () => {
      const { promises } = await import('node:fs/promises');
      vi.mocked(promises.readFile).mockResolvedValue(
        JSON.stringify({ assets: ['TSLA'], createdAt: '2026-01-01' })
      );
      vi.mocked(promises.writeFile).mockResolvedValue(undefined);

      await addAsset('PLTR');

      expect(vi.mocked(promises.readFile)).toHaveBeenCalledWith('.portfolio.json', 'utf-8');
      expect(vi.mocked(promises.writeFile)).toHaveBeenCalled();
      const writeCall = vi.mocked(promises.writeFile).mock.calls[0];
      expect(JSON.parse(writeCall[1])).toEqual({ assets: ['TSLA', 'PLTR'], createdAt: '2026-01-01' });
    });

    it('should not add duplicate asset', async () => {
      const { promises } = await import('node:fs/promises');
      vi.mocked(promises.readFile).mockResolvedValue(
        JSON.stringify({ assets: ['TSLA'], createdAt: '2026-01-01' })
      );
      vi.mocked(promises.writeFile).mockResolvedValue(undefined);

      await addAsset('TSLA');

      expect(vi.mocked(promises.writeFile)).not.toHaveBeenCalled();
    });
  });

  describe('removeAsset', () => {
    it('should remove asset from portfolio', async () => {
      const { promises } = await import('node:fs/promises');
      vi.mocked(promises.readFile).mockResolvedValue(
        JSON.stringify({ assets: ['TSLA', 'PLTR'], createdAt: '2026-01-01' })
      );
      vi.mocked(promises.writeFile).mockResolvedValue(undefined);

      await removeAsset('PLTR');

      const writeCall = vi.mocked(promises.writeFile).mock.calls[0];
      expect(JSON.parse(writeCall[1])).toEqual({ assets: ['TSLA'], createdAt: '2026-01-01' });
    });

    it('should warn if asset not found', async () => {
      const { promises } = await import('node:fs/promises');
      vi.mocked(promises.readFile).mockResolvedValue(
        JSON.stringify({ assets: ['TSLA'], createdAt: '2026-01-01' })
      );
      vi.mocked(promises.writeFile).mockResolvedValue(undefined);

      await removeAsset('AAPL');

      expect(vi.mocked(promises.writeFile)).not.toHaveBeenCalled();
    });
  });

  describe('generatePerformanceReport', () => {
    it('should generate markdown report for portfolio tickers', () => {
      const tickers = ['TSLA', 'PLTR'];
      const results: TickerResult[] = [
        {
          ticker: 'TSLA',
          date: '2026-01-24',
          close: 200,
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
          opinion: 'HOLD',
          atr: 5,
          stopLoss: 195,
          takeProfit: 205,
          trailingStop: 195,
          trailingStart: 202.5,
        },
        {
          ticker: 'PLTR',
          date: '2026-01-24',
          close: 25,
          volume: 500000,
          rsi: 55,
          stochasticK: 45,
          bbLower: 23,
          bbUpper: 27,
          donchLower: 22,
          donchUpper: 28,
          williamsR: -45,
          fearGreed: 55,
          patterns: [],
          score: 110,
          opinion: 'BUY',
          atr: 1,
          stopLoss: 24,
          takeProfit: 27,
          trailingStop: 24,
          trailingStart: 25.5,
        },
      ];

      const report = generatePerformanceReport(tickers, results);

      expect(report).toContain('# Portfolio Performance Report');
      expect(report).toContain('## TSLA');
      expect(report).toContain('## PLTR');
    });
  });
});
