import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { portfolioReportPath, predict, sortResults } from '@/commands/predict';
import {
  addAsset,
  generatePerformanceReport,
  getPortfolio,
  removeAsset,
} from '@/portfolio/manager';
import { getFearGreedIndex } from '@/services/data-fetcher';
import { getDividendInfo } from '@/services/dividends';
import { getEarningsData } from '@/services/earnings';
import { getFundamentals } from '@/services/fundamentals';
import { getStockNews } from '@/services/news';
import { getOptionsChain } from '@/services/options';
import { analyzeTickerContext } from '@/services/ticker-analysis';
import type { TickerResult } from '@/types';
import { printSummaryTable } from '@/ui/summary';
import { writeToCsv } from '@/utils/csv-writer';

vi.mock('@/portfolio/manager', () => ({
  addAsset: vi.fn(),
  generatePerformanceReport: vi.fn(),
  getPortfolio: vi.fn(),
  removeAsset: vi.fn(),
}));

vi.mock('@/services/data-fetcher', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/data-fetcher')>()),
  getFearGreedIndex: vi.fn(),
}));
vi.mock('@/services/ticker-analysis', () => ({ analyzeTickerContext: vi.fn() }));
vi.mock('@/services/fundamentals', () => ({ getFundamentals: vi.fn() }));
vi.mock('@/services/news', () => ({ getStockNews: vi.fn() }));
vi.mock('@/services/options', () => ({
  getOptionsChain: vi.fn(),
  formatOptionsData: vi.fn(() => 'options'),
}));
vi.mock('@/services/dividends', () => ({
  getDividendInfo: vi.fn(),
  formatDividendInfo: vi.fn(() => 'dividends'),
}));
vi.mock('@/services/earnings', () => ({
  getEarningsData: vi.fn(),
  formatEarningsData: vi.fn(() => 'earnings'),
}));
vi.mock('@/utils/config-loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/config-loader')>()),
  loadPipelineConfig: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/utils/csv-writer', () => ({ writeToCsv: vi.fn() }));
vi.mock('@/ui/summary', () => ({ printSummaryTable: vi.fn() }));
vi.mock('@/utils/whatsapp', () => ({
  sendWhatsAppNotification: vi.fn(),
  isWhatsAppNotificationConfigured: vi.fn().mockResolvedValue(false),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const result = (ticker: string, opinion: string, score: number): TickerResult => ({
  ticker,
  date: '2026-10-02',
  close: 100,
  volume: 1,
  rsi: 50,
  stochasticK: 50,
  bbLower: 90,
  bbUpper: 110,
  donchLower: 90,
  donchUpper: 110,
  williamsR: -50,
  fearGreed: 50,
  patterns: [],
  score,
  opinion,
  atr: 1,
  stopLoss: 98,
  takeProfit: 104,
  trailingStop: 98,
  trailingStart: 102,
  macd: 0,
  macdSignal: 0,
  macdHistogram: 0,
  sma20: 100,
  ema20: 100,
});

function analysisFor(decisions: Record<string, [string, number]>) {
  vi.mocked(analyzeTickerContext).mockImplementation(async (ticker) => {
    const decision = decisions[ticker];
    if (!decision) return null;
    return { result: result(ticker, decision[0], decision[1]) } as never;
  });
}

describe('predict portfolio actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getPortfolio).mockResolvedValue({ assets: ['TSLA'], createdAt: '2026-01-01' });
    vi.mocked(generatePerformanceReport).mockResolvedValue('# report');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it.each([
    { action: 'add', operation: addAsset },
    { action: 'remove', operation: removeAsset },
    { action: 'list', operation: getPortfolio },
  ] as const)('runs $action without fetching market sentiment', async ({ action, operation }) => {
    vi.mocked(getFearGreedIndex).mockRejectedValue(new Error('Market data unavailable'));

    await expect(
      predict({
        tickers: [],
        sort: 'asc',
        format: 'csv',
        portfolioAction: action,
        portfolioTicker: 'TSLA',
      })
    ).resolves.toBeUndefined();

    expect(operation).toHaveBeenCalledOnce();
    expect(getFearGreedIndex).not.toHaveBeenCalled();
  });

  it('reports on the saved portfolio assets by default and prints and saves the report', async () => {
    vi.mocked(getFearGreedIndex).mockResolvedValue(50);
    analysisFor({ TSLA: ['HOLD', 120] });

    await predict({ tickers: [], sort: 'asc', format: 'csv', portfolioAction: 'report' });

    expect(getPortfolio).toHaveBeenCalledOnce();
    expect(getFearGreedIndex).toHaveBeenCalledOnce();
    expect(analyzeTickerContext).toHaveBeenCalledWith('TSLA', 50, expect.anything());
    expect(generatePerformanceReport).toHaveBeenCalledWith(
      ['TSLA'],
      [expect.objectContaining({ ticker: 'TSLA', opinion: 'HOLD' })]
    );
    expect(console.log).toHaveBeenCalledWith('# report');
    expect(fs.writeFileSync).toHaveBeenCalledWith(portfolioReportPath(), '# report', 'utf-8');
    expect(portfolioReportPath()).toMatch(
      /[\\/]data[\\/]reports[\\/]portfolio-report-\d{4}-\d{2}-\d{2}\.md$/
    );
  });

  it('prefers explicit tickers over portfolio assets for the report', async () => {
    vi.mocked(getFearGreedIndex).mockResolvedValue(50);
    analysisFor({ OII: ['BUY', 300] });

    await predict({ tickers: ['OII'], sort: 'asc', format: 'csv', portfolioAction: 'report' });

    expect(getPortfolio).not.toHaveBeenCalled();
    expect(generatePerformanceReport).toHaveBeenCalledWith(
      ['OII'],
      [expect.objectContaining({ ticker: 'OII' })]
    );
  });

  it('warns instead of analyzing when the portfolio is empty', async () => {
    vi.mocked(getPortfolio).mockResolvedValue({ assets: [], createdAt: '2026-01-01' });

    await predict({ tickers: [], sort: 'asc', format: 'csv', portfolioAction: 'report' });

    expect(getFearGreedIndex).not.toHaveBeenCalled();
    expect(generatePerformanceReport).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe('predict extra data flags', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getFearGreedIndex).mockResolvedValue(50);
    vi.mocked(getFundamentals).mockResolvedValue(null as never);
    vi.mocked(getStockNews).mockResolvedValue([]);
    vi.mocked(getOptionsChain).mockResolvedValue(null as never);
    vi.mocked(getDividendInfo).mockResolvedValue(null as never);
    vi.mocked(getEarningsData).mockResolvedValue(null as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('applies every requested flag to every --ticker symbol after the prediction batch', async () => {
    analysisFor({ TSLA: ['HOLD', 100], PLTR: ['BUY', 300] });

    await predict({
      tickers: ['TSLA', 'PLTR'],
      sort: 'asc',
      format: 'csv',
      fundamentals: true,
      news: true,
      earnings: true,
      dividends: true,
      options: true,
    });

    expect(writeToCsv).toHaveBeenCalledOnce();
    expect(printSummaryTable).toHaveBeenCalledOnce();
    for (const fetcher of [getFundamentals, getOptionsChain, getDividendInfo, getEarningsData]) {
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher).toHaveBeenCalledWith('TSLA');
      expect(fetcher).toHaveBeenCalledWith('PLTR');
    }
    expect(getStockNews).toHaveBeenCalledWith('TSLA', 5);
    expect(getStockNews).toHaveBeenCalledWith('PLTR', 5);
  });

  it('skips extra data requests when no flag is set', async () => {
    analysisFor({ TSLA: ['HOLD', 100] });

    await predict({ tickers: ['TSLA'], sort: 'asc', format: 'csv' });

    expect(getFundamentals).not.toHaveBeenCalled();
    expect(getStockNews).not.toHaveBeenCalled();
  });

  it('keeps the legacy single --portfolio-ticker lookup without a prediction batch', async () => {
    await predict({
      tickers: [],
      sort: 'asc',
      format: 'csv',
      portfolioTicker: 'TSLA',
      fundamentals: true,
    });

    expect(getFundamentals).toHaveBeenCalledExactlyOnceWith('TSLA');
    expect(getFearGreedIndex).not.toHaveBeenCalled();
    expect(writeToCsv).not.toHaveBeenCalled();
  });
});

describe('sortResults', () => {
  const rows = [
    result('ZZZ', 'HOLD', 400),
    result('AAA', 'BUY', 250),
    result('MMM', 'SELL', 90),
    result('BBB', 'BUY', 310),
  ];

  it('orders by ticker by default and honours asc/desc', () => {
    expect(sortResults(rows, 'asc').map((r) => r.ticker)).toEqual(['AAA', 'BBB', 'MMM', 'ZZZ']);
    expect(sortResults(rows, 'desc').map((r) => r.ticker)).toEqual(['ZZZ', 'MMM', 'BBB', 'AAA']);
  });

  it('orders BUY, SELL, HOLD and then score descending for --sort-by=decision', () => {
    expect(sortResults(rows, 'asc', 'decision').map((r) => `${r.ticker}:${r.opinion}`)).toEqual([
      'BBB:BUY',
      'AAA:BUY',
      'MMM:SELL',
      'ZZZ:HOLD',
    ]);
  });

  it('passes the decision ordering through to the CSV writer', async () => {
    vi.resetAllMocks();
    vi.mocked(getFearGreedIndex).mockResolvedValue(50);
    analysisFor({ ZZZ: ['HOLD', 400], AAA: ['BUY', 250] });

    await predict({ tickers: ['ZZZ', 'AAA'], sort: 'asc', sortBy: 'decision', format: 'csv' });

    expect(vi.mocked(writeToCsv).mock.calls[0][0].map((r) => r.ticker)).toEqual(['AAA', 'ZZZ']);
  });
});
