import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import { DEFAULT_SCREENER_TICKERS } from '@/constants/screener';
import { gateReasons } from '@/reports/signal-reasons';
import { generateStockScreen, type StockScreenOptions } from '@/reports/stock-screen';
import type { analyzeTickerContext, TickerAnalysisContext } from '@/services/ticker-analysis';
import type { PipelineResult } from '@/types';

vi.mock('@/utils/config-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/config-loader')>();
  return {
    ...actual,
    loadPipelineConfig: vi.fn(async () => actual.cloneCanonicalPipelineConfig()),
  };
});

function context(
  ticker: string,
  decision: PipelineResult['finalDecision'] = 'BUY',
  buyScore = 250,
  sellScore = 5
): TickerAnalysisContext {
  return {
    result: {
      ticker,
      date: '2026-01-02',
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
      score: buyScore,
      opinion: decision,
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
      sector: 'Technology',
    },
    pipelineResult: {
      ticker,
      finalDecision: decision,
      score: decision === 'SELL' ? sellScore : buyScore,
      buyScore,
      sellScore,
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
    dailyPrices: [],
    spyCandles: [],
    sectorCandles: [],
    sectorETF: null,
    config: DEFAULT_QUALITY_PIPELINE_CONFIG,
  };
}

function analyzer() {
  return vi.fn<typeof analyzeTickerContext>().mockImplementation(async (ticker) => context(ticker));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('generateStockScreen', () => {
  it('freezes one complete active configuration for all candidates', async () => {
    const first = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    first.thresholds.buy = 215;
    const changed = structuredClone(first);
    changed.thresholds.buy = 250;
    const load = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(changed);
    const analyze = analyzer();

    const { screen } = await generateStockScreen(
      { tickers: ['AAPL', 'OII'] },
      { analyzeTickerContext: analyze, loadPipelineConfig: load }
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.criteria.pipelineConfig).toEqual(first);
    expect(analyze.mock.calls.map((call) => call[2]?.pipelineConfig)).toEqual([first, first]);
  });

  it('uses exactly the existing web screener’s 20 symbols, BUY filter, 730 days, and result limit 20', async () => {
    const analyze = analyzer();

    const { screen, markdown } = await generateStockScreen({}, { analyzeTickerContext: analyze });

    expect(DEFAULT_SCREENER_TICKERS).toEqual([
      'TSLA',
      'PLTR',
      'GOOGL',
      'NVDA',
      'AAPL',
      'META',
      'AMD',
      'MSFT',
      'AMZN',
      'NFLX',
      'CRWD',
      'NET',
      'DDOG',
      'COIN',
      'SOFI',
      'XYZ',
      'SHOP',
      'UBER',
      'SNAP',
      'PINS',
    ]);
    expect(screen.universe).toEqual({
      source: 'default-screener',
      tickers: [...DEFAULT_SCREENER_TICKERS],
    });
    expect(screen.criteria).toMatchObject({
      decision: 'BUY',
      lookbackDays: 730,
      limit: 20,
      timeBudgetMs: 45_000,
      sort: { metric: 'buyScore', order: 'descending', tieBreaker: 'ticker-ascending' },
    });
    expect(screen.coverage).toEqual({
      requested: 20,
      analyzed: 20,
      unavailable: 0,
      matched: 20,
      returned: 20,
      truncated: false,
    });
    expect(screen.decisionCounts).toEqual({ BUY: 20, SELL: 0, HOLD: 0 });
    expect(analyze.mock.calls.map((call) => call[0])).toEqual([...DEFAULT_SCREENER_TICKERS]);
    for (const call of analyze.mock.calls)
      expect(call.slice(1)).toEqual([
        null,
        { lookbackDays: 730, pipelineConfig: screen.criteria.pipelineConfig },
      ]);
    expect(markdown).toContain('not the entire market');
    expect(markdown).toContain('not probabilities of profit');
    expect(markdown).toContain('analyze_stock');
    expect(markdown).toContain('not independent new trade opportunities');
    expect(screen).not.toHaveProperty('historical');
  });

  it('filters only final engine decisions, retaining high-score gate-blocked HOLD as an exclusion', async () => {
    const analyze = analyzer().mockImplementation(async (ticker) => {
      const result = context(
        ticker,
        ticker === 'BLOCKED' ? 'HOLD' : 'BUY',
        ticker === 'BLOCKED' ? 350 : 230
      );
      if (ticker === 'BLOCKED') {
        result.pipelineResult.qualityBlocked = true;
        result.pipelineResult.gateResults.trend.passed = false;
        result.result.opinion = 'BUY';
      } else {
        // Institutional pass is not a separate decision rule added by the screener.
        result.pipelineResult.gateResults.institutional.passed = false;
      }
      return result;
    });

    const { screen } = await generateStockScreen(
      { tickers: ['BLOCKED', 'QUALIFIED'] },
      { analyzeTickerContext: analyze }
    );

    expect(screen.matches.map((match) => match.ticker)).toEqual(['QUALIFIED']);
    expect(screen.excluded).toHaveLength(1);
    expect(screen.excluded[0]).toMatchObject({
      ticker: 'BLOCKED',
      decision: 'HOLD',
      buyScore: 350,
    });
    expect(screen.excluded[0]?.gateReasons).toContain(
      'The entry-quality gate rejected this score-qualified BUY setup.'
    );
    expect(screen.excluded[0]?.gateReasons.some((reason) => reason.includes('blocked'))).toBe(true);
    expect(screen.decisionCounts).toEqual({ BUY: 1, SELL: 0, HOLD: 1 });
  });

  it('normalizes and deduplicates provided tickers before requesting each unique symbol once', async () => {
    const analyze = analyzer();

    const { screen } = await generateStockScreen(
      { tickers: [' aapl ', 'AAPL', 'brk-b', '^gspc', '005930.KS', 'CL=F'] },
      { analyzeTickerContext: analyze }
    );

    expect(screen.universe).toEqual({
      source: 'provided',
      tickers: ['AAPL', 'BRK-B', '^GSPC', '005930.KS', 'CL=F'],
    });
    expect(analyze).toHaveBeenCalledTimes(5);
    expect(screen.coverage.requested).toBe(5);
  });

  it('sorts matching BUY signals by BUY score and ticker ties and reports limit truncation separately from exclusions', async () => {
    const scores: Record<string, number> = { LOW: 210, ZZZ: 300, AAA: 300, MIDDLE: 250 };
    const analyze = analyzer().mockImplementation(async (ticker) =>
      context(ticker, 'BUY', scores[ticker])
    );

    const { screen, markdown } = await generateStockScreen(
      { tickers: ['LOW', 'ZZZ', 'AAA', 'MIDDLE'], limit: 2 },
      { analyzeTickerContext: analyze }
    );

    expect(screen.matches.map((match) => match.ticker)).toEqual(['AAA', 'ZZZ']);
    expect(screen.coverage).toMatchObject({ matched: 4, returned: 2, truncated: true });
    expect(screen.excluded).toEqual([]);
    expect(screen.decisionCounts.BUY).toBe(4);
    expect(markdown).toContain('4 matched, 2 returned (truncated by limit)');
  });

  it('sorts SELL by SELL score and treats SELL as a long-holder exit rather than a short entry', async () => {
    const analyze = analyzer().mockImplementation(async (ticker) =>
      ticker === 'BIGSELL' ? context(ticker, 'SELL', 1, 500) : context(ticker, 'SELL', 450, 100)
    );

    const { screen, markdown } = await generateStockScreen(
      { tickers: ['BIGBUY', 'BIGSELL'], decision: 'SELL' },
      { analyzeTickerContext: analyze }
    );

    expect(screen.matches.map((match) => match.ticker)).toEqual(['BIGSELL', 'BIGBUY']);
    expect(screen.criteria.sort.metric).toBe('sellScore');
    expect(screen.matches.every((match) => match.execution.entry.eligible === false)).toBe(true);
    expect(markdown).toContain('long-holder exit warning');
    expect(markdown).toContain('not a short-entry recommendation');
  });

  it('supports HOLD and ALL without reclassifying engine signals', async () => {
    const decisions: Record<string, PipelineResult['finalDecision']> = {
      ONE: 'BUY',
      TWO: 'SELL',
      THREE: 'HOLD',
    };
    const analyze = analyzer().mockImplementation(async (ticker) =>
      context(ticker, decisions[ticker])
    );
    const tickers = ['ONE', 'TWO', 'THREE'];

    const hold = await generateStockScreen(
      { tickers, decision: 'HOLD' },
      { analyzeTickerContext: analyze }
    );
    const all = await generateStockScreen(
      { tickers, decision: 'ALL' },
      { analyzeTickerContext: analyze }
    );

    expect(hold.screen.matches.map((match) => match.ticker)).toEqual(['THREE']);
    expect(hold.screen.matches[0]?.execution.entry.eligible).toBe(false);
    expect(all.screen.matches).toHaveLength(3);
    expect(all.screen.excluded).toEqual([]);
    expect(all.screen.decisionCounts).toEqual({ BUY: 1, SELL: 1, HOLD: 1 });
    expect(all.screen.criteria.sort.metric).toBe('buyScore');
  });

  it('returns a normal available empty BUY screen when completed analyses have only HOLD or SELL', async () => {
    const analyze = analyzer().mockImplementation(async (ticker) =>
      context(ticker, ticker === 'ONE' ? 'HOLD' : 'SELL')
    );

    const { screen, markdown } = await generateStockScreen(
      { tickers: ['ONE', 'TWO'] },
      { analyzeTickerContext: analyze }
    );

    expect(screen.status).toBe('available');
    expect(screen.matches).toEqual([]);
    expect(screen.coverage).toMatchObject({ analyzed: 2, unavailable: 0, matched: 0, returned: 0 });
    expect(markdown).toContain('No analyzed ticker has final decision BUY.');
  });

  it('preserves successes, classifies null and rejected ticker failures, and strips private errors', async () => {
    const analyze = analyzer().mockImplementation(async (ticker) => {
      if (ticker === 'EMPTY') return null;
      if (ticker === 'ERROR') throw new Error('https://provider.example/?apikey=fixture-secret');
      return context(ticker);
    });

    const result = await generateStockScreen(
      { tickers: ['GOOD', 'ERROR', 'EMPTY'] },
      { analyzeTickerContext: analyze }
    );

    expect(result.screen.status).toBe('partial');
    expect(result.screen.matches.map((match) => match.ticker)).toEqual(['GOOD']);
    expect(result.screen.coverage).toMatchObject({ requested: 3, analyzed: 1, unavailable: 2 });
    expect(result.screen.unavailable).toEqual([
      { ticker: 'ERROR', reason: 'Analysis could not be completed for this ticker.' },
      { ticker: 'EMPTY', reason: 'No usable completed-session analysis is available.' },
    ]);
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
    expect(JSON.stringify(result)).not.toContain('provider.example');
  });

  it('returns unavailable with truthful coverage if every ticker fails', async () => {
    const analyze = analyzer().mockResolvedValue(null);

    const { screen, markdown } = await generateStockScreen(
      { tickers: ['ONE', 'TWO'] },
      { analyzeTickerContext: analyze }
    );

    expect(screen.status).toBe('unavailable');
    expect(screen.matches).toEqual([]);
    expect(screen.coverage).toEqual({
      requested: 2,
      analyzed: 0,
      unavailable: 2,
      matched: 0,
      returned: 0,
      truncated: false,
    });
    expect(screen.decisionCounts).toEqual({ BUY: 0, SELL: 0, HOLD: 0 });
    expect(markdown).toContain('No ticker could be analyzed.');
  });

  it('projects the unchanged shared gate explanations and keeps future execution prices unknown', async () => {
    const source = context('ONE');
    const analyze = analyzer().mockResolvedValue(source);

    const { screen } = await generateStockScreen(
      { tickers: ['ONE'] },
      { analyzeTickerContext: analyze }
    );

    expect(screen.matches[0]?.gateReasons).toEqual(gateReasons(source));
    expect(screen.matches[0]?.gates).toEqual(source.pipelineResult.gateResults);
    expect(screen.matches[0]?.execution).toEqual({
      entry: { status: 'conditional', timing: 'next-session-open', price: null, eligible: true },
      reference: {
        basis: 'latest-completed-close',
        price: 100,
        atr: 2,
        stopLoss: 97,
        takeProfit: 106,
        trailingStop: 97,
        trailingStart: 101,
      },
    });
    expect(screen.matches[0]?.rsi).toBe(50);
    expect(screen.matches[0]?.sector).toBe('Technology');
  });

  it.each(['close', 'atr', 'stopLoss', 'takeProfit', 'trailingStop', 'trailingStart'] as const)(
    'does not return a fabricated finite risk reference when %s is invalid',
    async (field) => {
      const source = context('ONE');
      source.result[field] = Number.POSITIVE_INFINITY;
      source.result.rsi = Number.NaN;
      const analyze = analyzer().mockResolvedValue(source);

      const { screen } = await generateStockScreen(
        { tickers: ['ONE'] },
        { analyzeTickerContext: analyze }
      );

      expect(screen.matches[0]?.decision).toBe('BUY');
      expect(screen.matches[0]?.execution.reference).toBeNull();
      expect(screen.matches[0]?.execution.entry.price).toBeNull();
      expect(screen.matches[0]?.rsi).toBeNull();
      expect(JSON.stringify(screen)).not.toContain('Infinity');
      expect(screen.warnings).toContain(
        'Some matching tickers have unavailable completed-close risk references.'
      );
    }
  );

  it('excludes invalid engine scores as unavailable instead of ranking them as valid results', async () => {
    const source = context('BROKEN');
    source.pipelineResult.buyScore = Number.NaN;
    const analyze = analyzer().mockResolvedValue(source);

    const { screen } = await generateStockScreen(
      { tickers: ['BROKEN'] },
      { analyzeTickerContext: analyze }
    );

    expect(screen.status).toBe('unavailable');
    expect(screen.coverage.analyzed).toBe(0);
    expect(screen.unavailable).toHaveLength(1);
  });

  it('never has more than two ticker analyses in progress', async () => {
    let active = 0;
    let peak = 0;
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const analyze = analyzer().mockImplementation(async (ticker) => {
      active++;
      peak = Math.max(peak, active);
      await blocked;
      active--;
      return context(ticker);
    });

    const request = generateStockScreen(
      { tickers: ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'] },
      { analyzeTickerContext: analyze }
    );
    await Promise.resolve();
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(peak).toBe(2);
    release?.();
    const result = await request;

    expect(result.screen.coverage.analyzed).toBe(5);
    expect(peak).toBe(2);
    expect(active).toBe(0);
  });

  it('returns a deadline snapshot with running and unstarted failures, without launching more or mutating late', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const analyze = analyzer().mockImplementation(async (ticker) => {
      await blocked;
      return context(ticker);
    });

    const pending = generateStockScreen(
      { tickers: ['ONE', 'TWO', 'THREE', 'FOUR'] },
      { analyzeTickerContext: analyze, timeBudgetMs: 20 }
    );
    await vi.advanceTimersByTimeAsync(20);
    const result = await pending;
    const snapshot = JSON.stringify(result);

    expect(result.screen.status).toBe('unavailable');
    expect(result.screen.criteria.timeBudgetMs).toBe(20);
    expect(result.screen.coverage).toMatchObject({ requested: 4, analyzed: 0, unavailable: 4 });
    expect(result.screen.unavailable).toEqual([
      {
        ticker: 'ONE',
        reason: 'Screen time budget exhausted while ticker analysis was in progress.',
      },
      {
        ticker: 'TWO',
        reason: 'Screen time budget exhausted while ticker analysis was in progress.',
      },
      { ticker: 'THREE', reason: 'Screen time budget exhausted before ticker analysis started.' },
      { ticker: 'FOUR', reason: 'Screen time budget exhausted before ticker analysis started.' },
    ]);
    expect(analyze).toHaveBeenCalledTimes(2);
    release?.();
    for (let tick = 0; tick < 10; tick++) await Promise.resolve();
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).toBe(snapshot);
  });

  it('keeps pre-deadline matches in a partial result, stops queue launch, and ignores late rejections', async () => {
    vi.useFakeTimers();
    let rejectPending: ((error: Error) => void) | undefined;
    const blocked = new Promise<void>((_resolve, reject) => {
      rejectPending = reject;
    });
    const analyze = analyzer().mockImplementation(async (ticker) => {
      if (ticker === 'ONE') return context(ticker);
      await blocked;
      return context(ticker);
    });

    const pending = generateStockScreen(
      { tickers: ['ONE', 'TWO', 'THREE', 'FOUR'] },
      { analyzeTickerContext: analyze, timeBudgetMs: 20 }
    );
    await vi.advanceTimersByTimeAsync(20);
    const result = await pending;
    const snapshot = JSON.stringify(result);

    expect(result.screen.status).toBe('partial');
    expect(result.screen.matches.map((match) => match.ticker)).toEqual(['ONE']);
    expect(result.screen.coverage).toMatchObject({
      analyzed: 1,
      unavailable: 3,
      matched: 1,
      returned: 1,
    });
    expect(analyze).toHaveBeenCalledTimes(3);
    rejectPending?.(new Error('private-provider-error'));
    for (let tick = 0; tick < 10; tick++) await Promise.resolve();
    expect(analyze).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).toBe(snapshot);
  });

  it.each<StockScreenOptions>([
    { tickers: [] },
    { tickers: Array(51).fill('ONE') },
    { tickers: ['GOOD', '../BAD'] },
    { tickers: ['GOOD', ''] },
    { tickers: ['A'.repeat(33)] },
    { tickers: ['GOOD', 'ONE,TWO'] },
    { tickers: ['GOOD', 'ONE\u0000'] },
    { lookbackDays: 729 },
    { lookbackDays: 3651 },
    { lookbackDays: 730.1 },
    { lookbackDays: Number.NaN },
    { limit: 0 },
    { limit: 51 },
    { limit: 1.1 },
    { limit: Number.POSITIVE_INFINITY },
  ])('validates all input before any analysis request: %j', async (options) => {
    const analyze = analyzer();

    await expect(generateStockScreen(options, { analyzeTickerContext: analyze })).rejects.toThrow(
      TypeError
    );
    expect(analyze).not.toHaveBeenCalled();
  });

  it.each([
    { tickers: null },
    { tickers: [123] },
    { decision: 'buy' },
    { decision: null },
    { lookbackDays: null },
    { limit: null },
  ])('rejects malformed runtime options without provider calls: %j', async (options) => {
    const analyze = analyzer();

    await expect(
      generateStockScreen(options as unknown as StockScreenOptions, {
        analyzeTickerContext: analyze,
      })
    ).rejects.toThrow(TypeError);
    expect(analyze).not.toHaveBeenCalled();
  });

  it.each([0, 45_001, Number.NaN, 1.1])(
    'validates an injected time budget %s before calls',
    async (timeBudgetMs) => {
      const analyze = analyzer();

      await expect(
        generateStockScreen({}, { analyzeTickerContext: analyze, timeBudgetMs })
      ).rejects.toThrow(TypeError);
      expect(analyze).not.toHaveBeenCalled();
    }
  );

  it('accepts 50 normalized symbols, maximum lookback, and maximum return limit', async () => {
    const analyze = analyzer();

    const { screen } = await generateStockScreen(
      {
        tickers: Array.from({ length: 50 }, (_, index) => `P${index}`),
        lookbackDays: 3650,
        limit: 50,
      },
      { analyzeTickerContext: analyze }
    );

    expect(screen.matches).toHaveLength(50);
    expect(screen.coverage.requested).toBe(50);
    expect(screen.coverage.truncated).toBe(false);
    expect(analyze).toHaveBeenCalledWith('P0', null, {
      lookbackDays: 3650,
      pipelineConfig: screen.criteria.pipelineConfig,
    });
  });
});
