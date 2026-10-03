import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import { type BacktestSignal, type Candle, runSignalsWithContext } from '@/optimization/engine';
import { generateStockAnalystReport } from '@/reports/stock-analyst';
import { type AnalystTargetsReport, getAnalystTargets } from '@/services/analyst-targets';
import { analyzeTickerContext, type TickerAnalysisContext } from '@/services/ticker-analysis';
import { getValuation, type ValuationReport } from '@/services/valuation';

vi.mock('@/services/ticker-analysis', () => ({ analyzeTickerContext: vi.fn() }));
vi.mock('@/services/analyst-targets', () => ({ getAnalystTargets: vi.fn() }));
vi.mock('@/services/valuation', () => ({ getValuation: vi.fn() }));
vi.mock('@/optimization/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/optimization/engine')>()),
  runSignalsWithContext: vi.fn(),
}));

const prices: Candle[] = Array.from({ length: 211 }, (_, index) => ({
  date: new Date(Date.UTC(2025, 0, 1 + index)),
  open: 100,
  high: 102,
  low: 98,
  close: 100,
  volume: 2_000_000,
}));

const context: TickerAnalysisContext = {
  result: {
    ticker: 'TEST',
    date: prices[210].date.toISOString().slice(0, 10),
    close: 100,
    volume: 2_000_000,
    rsi: 50,
    stochasticK: 50,
    bbLower: 98,
    bbUpper: 102,
    donchLower: 98,
    donchUpper: 102,
    williamsR: -50,
    fearGreed: null,
    patterns: [],
    score: 130,
    opinion: 'BUY',
    atr: 2,
    stopLoss: 97,
    takeProfit: 106,
    trailingStop: 97,
    trailingStart: 101,
    macd: 0,
    macdSignal: 0,
    macdHistogram: 0,
    sma20: 100,
    ema20: 100,
    buyProbability: 90,
    sellProbability: 5,
    holdProbability: 5,
  },
  pipelineResult: {
    ticker: 'TEST',
    finalDecision: 'BUY',
    score: 130,
    buyScore: 130,
    sellScore: 5,
    confidence: 60,
    gateResults: {
      trend: { passed: true, regime: 'uptrend', strength: 100, reason: 'upward trend' },
      confluence: { passed: true, activeIndicators: 5, totalIndicators: 6, ratio: 5 / 6 },
      reversal: { status: 'confirmed', trigger: 'both' },
      institutional: {
        score: 0.8,
        passed: true,
        components: {
          rsSpy: 1,
          rsSector: 1,
          vwap: 1,
          breakoutVol: 1,
          liquidity: 1,
          earnings: 0,
        },
      },
    },
  },
  dailyPrices: prices,
  spyCandles: [],
  sectorCandles: [],
  sectorETF: null,
  config: DEFAULT_QUALITY_PIPELINE_CONFIG,
};

const targets: AnalystTargetsReport = {
  ticker: 'TEST',
  retrievedAt: '2026-10-03T00:00:00.000Z',
  consensus: null,
  recent: {
    status: 'unavailable',
    source: null,
    retrievedAt: '2026-10-03T00:00:00.000Z',
    windowDays: 90,
    count30Days: 0,
    updates: [],
    limit: null,
    reason: 'No target updates supplied.',
  },
  warnings: ['Consensus targets are unavailable.'],
};

const historicalBuy: BacktestSignal = {
  date: prices[205].date,
  ticker: 'TEST',
  close: 100,
  decision: 'BUY',
  score: 100,
  regime: 'uptrend',
  confluenceRatio: 1,
  rsSpy: 1,
  rsSector: 1,
  vwap: 1,
  breakoutVol: 1,
  rsi: 50,
  stochK: 50,
  williamsR: -50,
  atr: 2,
  volumeRatio: 1,
  trendStrength: 100,
  sma50dist: 0,
  sma200dist: 0,
  rsiDelta: 0,
  priceDelta: 0,
  ibs: 0.5,
  rsi2cumul: 100,
  atrDistance: 0,
  consecutiveOversold: 0,
};

const valuation: ValuationReport = {
  ticker: 'TEST',
  retrievedAt: '2026-10-03T00:00:00.000Z',
  company: {
    trailingPE: 12,
    forwardPE: 10,
    psr: 1.2,
    currency: 'USD',
    sector: 'Energy',
    industry: 'Oil & Gas Equipment & Services',
    industryKey: 'oil-gas-equipment-services',
    priceAsOf: null,
    sourceUrl: 'https://finance.yahoo.com/quote/TEST/key-statistics/',
    peReason: null,
    psrReason: null,
  },
  industryComparison: {
    status: 'available',
    medianPE: 15,
    medianPSR: 2,
    peSamples: 3,
    psrSamples: 3,
    peers: [
      {
        ticker: 'AAA',
        trailingPE: 10,
        psr: 1,
        industry: 'Oil & Gas Equipment & Services',
        currency: 'USD',
      },
      {
        ticker: 'BBB',
        trailingPE: 15,
        psr: 2,
        industry: 'Oil & Gas Equipment & Services',
        currency: 'USD',
      },
      {
        ticker: 'CCC',
        trailingPE: 20,
        psr: 3,
        industry: 'Oil & Gas Equipment & Services',
        currency: 'USD',
      },
    ],
    method: 'Unweighted median of positive finite TTM values; at least 3 samples per metric',
    sourceUrl: 'https://finance.yahoo.com/markets/stocks/industry/oil-gas-equipment-services/',
    universe: 'Yahoo-selected US-region top companies, up to 12 same-industry peers',
    coverage: {
      candidateCount: 3,
      requestedCount: 3,
      matchingIndustryCount: 3,
      failedRequests: 0,
      excludedIndustryCount: 0,
      excludedNonEquityCount: 0,
      providerCompanyCount: 30,
      peerLimit: 12,
      minimumSamples: 3,
    },
    reason: null,
  },
  relative: { pePremiumPct: -20, psrPremiumPct: -40 },
  warnings: ['Selected peer medians are not whole-industry averages.'],
};

beforeEach(() => {
  vi.mocked(analyzeTickerContext).mockResolvedValue(context);
  vi.mocked(getAnalystTargets).mockResolvedValue(targets);
  vi.mocked(getValuation).mockResolvedValue(valuation);
  vi.mocked(runSignalsWithContext).mockReturnValue([historicalBuy]);
});

describe('stock analyst report', () => {
  it('returns TTM valuation and peer samples while keeping forward PER separate', async () => {
    const { report, markdown } = await generateStockAnalystReport(' test ');
    expect(getValuation).toHaveBeenCalledWith('TEST');
    expect(report.valuation).toEqual(valuation);
    expect(markdown).toContain('| TTM PER | 12.00 | 15.00 | 3 | -20.00% |');
    expect(markdown).toContain('| TTM PSR | 1.20 | 2.00 | 3 | -40.00% |');
    expect(markdown).toContain('Forward PER: 10.00; it is separate from the TTM comparison.');
    expect(markdown).toContain('Compared tickers: AAA, BBB, CCC');
    expect(report.warnings).toContain('Selected peer medians are not whole-industry averages.');
  });

  it('preserves technical analysis when the optional valuation service fails', async () => {
    vi.mocked(getValuation).mockRejectedValue(new Error('Provider is unavailable'));
    const { report, markdown } = await generateStockAnalystReport('TEST');
    expect(report.status).toBe('available');
    expect(report.current?.decision).toBe('BUY');
    expect(report.historical.fixedHold.samples).toBe(1);
    expect(report.valuation).toBeNull();
    expect(markdown).toContain('Valuation data is unavailable.');
    expect(report.warnings.join(' ')).toContain('Valuation data could not be retrieved');
  });

  it('keeps the future fill unknown and separates score weights from observed net wins', async () => {
    const { report, markdown } = await generateStockAnalystReport(' test ');
    expect(analyzeTickerContext).toHaveBeenCalledWith('TEST', null, { lookbackDays: 2920 });
    expect(runSignalsWithContext).toHaveBeenCalledWith(expect.any(Object), 'TEST', context.config);
    expect(report.dataAsOf).toBe(context.result.date);
    expect(report.execution.entry).toEqual({
      status: 'conditional',
      timing: 'next-session-open',
      price: null,
      eligible: true,
    });
    expect(report.execution.reference).toMatchObject({
      basis: 'latest-completed-close',
      price: 100,
      stopLoss: 97,
      takeProfit: 106,
    });
    expect(report.current?.scoreWeights.buy).toBe(90);
    expect(report.historical.fixedHold).toMatchObject({ samples: 1, wins: 0, winRatePct: 0 });
    expect(report.historical.period.from).toBe(prices[206].date.toISOString().slice(0, 10));
    expect(markdown).toContain('CONDITIONAL next-session open');
    expect(markdown).toContain('Recompute levels from the actual next-session fill');
    expect(markdown).toContain('These are not profit probabilities');
    expect(report.warnings.join(' ')).toContain('small sample');
  });

  it('reports unavailable data and null success rates when price analysis is absent', async () => {
    vi.mocked(analyzeTickerContext).mockResolvedValue(null);
    const { report, markdown } = await generateStockAnalystReport('TEST');
    expect(report.status).toBe('unavailable');
    expect(report.current).toBeNull();
    expect(report.execution.entry.price).toBeNull();
    expect(report.execution.entry.eligible).toBe(false);
    expect(report.historical.fixedHold.winRatePct).toBeNull();
    expect(report.historical.atrBarriers.targetTouchRatePct).toBeNull();
    expect(report.historical.period).toEqual({ from: null, to: null });
    expect(markdown).toContain('net win rate: N/A (0/0)');
    expect(runSignalsWithContext).not.toHaveBeenCalled();
  });

  it('does not report indicator-warmup dates as an eligible historical period', async () => {
    vi.mocked(analyzeTickerContext).mockResolvedValue({
      ...context,
      dailyPrices: prices.slice(0, 209),
    });
    const { report } = await generateStockAnalystReport('TEST', { lookbackDays: 730 });
    expect(report.historical.period).toEqual({ from: null, to: null });
    expect(report.historical.fixedHold.samples).toBe(0);
    expect(report.historical.fixedHold.winRatePct).toBeNull();
    expect(report.warnings.join(' ')).toContain('210 completed sessions');
  });

  it.each(['AAPL,MSFT', '../../file', 'https://example.com', ''])(
    'rejects invalid symbol %s before fetching data',
    async (ticker) => {
      await expect(generateStockAnalystReport(ticker)).rejects.toThrow(TypeError);
      expect(analyzeTickerContext).not.toHaveBeenCalled();
      expect(getAnalystTargets).not.toHaveBeenCalled();
      expect(getValuation).not.toHaveBeenCalled();
    }
  );

  it.each([729, 3651, 730.5, Number.NaN])(
    'rejects invalid lookback %s before fetching data',
    async (lookbackDays) => {
      await expect(generateStockAnalystReport('TEST', { lookbackDays })).rejects.toThrow(TypeError);
      expect(analyzeTickerContext).not.toHaveBeenCalled();
    }
  );

  it('escapes external analyst firm formatting in Markdown', async () => {
    vi.mocked(getAnalystTargets).mockResolvedValue({
      ...targets,
      recent: {
        ...targets.recent,
        status: 'available',
        source: 'Yahoo Finance',
        count30Days: 1,
        updates: [
          {
            source: 'Yahoo Finance',
            sourceUrl: null,
            publishedAt: '2026-10-01',
            firm: '[unsafe](javascript:alert)',
            analystName: null,
            targetPrice: 130,
            currency: null,
            priorTargetPrice: null,
            priceWhenPosted: null,
            rating: null,
            action: null,
            horizon: null,
          },
        ],
      },
    });
    const { markdown } = await generateStockAnalystReport('TEST');
    expect(markdown).toContain('\\[unsafe\\]\\(javascript:alert\\)');
    expect(markdown).not.toContain('[unsafe](javascript:alert)');
    expect(markdown).toContain('currency unknown / unprovided');
    expect(markdown).toContain('prior target N/A');
  });
});
