import { promises as fs } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAsset, generatePerformanceReport, removeAsset } from '@/portfolio/manager';
import type { TickerResult } from '@/types';

vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mocked(fs.readFile).mockResolvedValue(
  JSON.stringify({ assets: [], createdAt: new Date().toISOString() })
);
vi.mocked(fs.writeFile).mockResolvedValue(undefined);

describe('portfolio manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addAsset', () => {
    it('should add new asset to portfolio', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ assets: ['TSLA'], createdAt: '2026-01-01' })
      );
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await addAsset('PLTR');

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith('.portfolio.json', 'utf-8');
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        '.portfolio.json',
        JSON.stringify({ assets: ['TSLA', 'PLTR'], createdAt: '2026-01-01' }, null, 2),
        'utf-8'
      );
    });

    it('should not add duplicate asset', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ assets: ['TSLA'], createdAt: '2026-01-01' })
      );
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await addAsset('TSLA');

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith('.portfolio.json', 'utf-8');
      expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    });
  });

  describe('removeAsset', () => {
    it('should remove asset from portfolio', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ assets: ['TSLA', 'PLTR'], createdAt: '2026-01-01' })
      );
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await removeAsset('PLTR');

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith('.portfolio.json', 'utf-8');
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalled();
    });

    it('should warn if asset not found', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ assets: ['TSLA'], createdAt: '2026-01-01' })
      );
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await removeAsset('AAPL');

      expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    });
  });

  describe('generatePerformanceReport', () => {
    it('should generate markdown report for portfolio tickers', async () => {
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
          macd: 0,
          macdSignal: 0,
          macdHistogram: 0,
          sma20: 195,
          ema20: 195,
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
          macd: 0,
          macdSignal: 0,
          macdHistogram: 0,
          sma20: 200,
          ema20: 200,
        },
      ];

      const report = await generatePerformanceReport(tickers, results);

      expect(report).toContain('# Portfolio Performance Report');
      expect(report).toContain('## TSLA');
      expect(report).toContain('## PLTR');
      expect(report).toContain('Generated:');
    });
  });
});
