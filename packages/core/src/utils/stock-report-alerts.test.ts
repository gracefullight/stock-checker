import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import { type BacktestSignal, type Candle, runSignalsWithContext } from '@/optimization/engine';
import type { HistoricalOutcomesReport } from '@/reports/historical-outcomes';
import { type AnalystTargetsReport, getAnalystTargets } from '@/services/analyst-targets';
import { analyzeTickerContext, type TickerAnalysisContext } from '@/services/ticker-analysis';
import {
  buildStockReportWhatsAppNotification,
  formatStockReportWhatsAppNotification,
  type StockReportAlertCandidate,
  type StockReportAlertDetail,
  type StockReportAlertGenerator,
  type StockReportAlertInput,
} from '@/utils/stock-report-alerts';

vi.mock('@/services/ticker-analysis', () => ({ analyzeTickerContext: vi.fn() }));
vi.mock('@/services/analyst-targets', () => ({ getAnalystTargets: vi.fn() }));
vi.mock('@/optimization/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/optimization/engine')>()),
  runSignalsWithContext: vi.fn(),
}));

function candidate(ticker = 'AAPL'): StockReportAlertCandidate {
  return {
    ticker,
    decision: 'BUY',
    dataAsOf: '2026-10-02',
    gateReasons: ['Trend passed; BUY 130 / threshold 100.', 'Institutional flow passed.'],
    reference: { price: 100, stopLoss: 97, takeProfit: 106, atr: 2 },
  };
}

function input(candidates = [candidate()]): StockReportAlertInput {
  return {
    title: 'Stock Checker 상세 알림',
    asOf: 'Scan completed 2026-10-05T03:30:00.000Z',
    coverageSummary: 'BUY 필터; 분석 19/20; 일치 5; 실패 1; 반환 4/5.',
    lookbackDays: 730,
    candidates,
  };
}

function historical(): HistoricalOutcomesReport {
  return {
    period: { from: '2024-10-01', to: '2026-09-25' },
    method: {
      horizonSessions: 5,
      entry: 'next-session-open',
      fixedHoldExit: 'fifth-session-close',
      roundTripCostBps: 10,
      sampleUnit: 'completed BUY observations; overlap permitted',
      atrBasis: 'signal-session ATR with actual next-session open',
    },
    buySignals: 5,
    excluded: { incomplete: 1, invalidExecution: 0, invalidAtrOrCandles: 0 },
    fixedHold: { samples: 4, wins: 3, winRatePct: 75, averageNetReturnPct: 1, rewardRisk: 2 },
    atrBarriers: {
      samples: 4,
      stopTouched: 1,
      targetTouched: 2,
      bothTouched: 1,
      stopTouchRatePct: 25,
      targetTouchRatePct: 50,
      stopFirst: 1,
      targetFirst: 1,
      ambiguousFirstTouch: 1,
      neitherTouched: 1,
      gapStopFirst: 0,
      gapTargetFirst: 0,
    },
  };
}

function targets(ticker = 'AAPL'): AnalystTargetsReport {
  const retrievedAt = '2026-10-05T03:30:00.000Z';
  return {
    ticker,
    retrievedAt,
    consensus: {
      source: 'Yahoo Finance',
      sourceUrl: `https://finance.yahoo.com/quote/${ticker}/analysis/`,
      retrievedAt,
      publishedAt: null,
      horizon: null,
      currency: 'USD',
      currentPrice: 100,
      mean: 150,
      median: 145,
      low: 120,
      high: 180,
      analystCount: 8,
      meanUpsidePercent: 50,
    },
    recent: {
      status: 'available',
      source: 'Financial Modeling Prep',
      retrievedAt,
      windowDays: 90,
      count30Days: 2,
      limit: 20,
      reason: null,
      updates: ['2026-10-01T00:00:00.000Z', '2026-10-04T00:00:00.000Z'].map(
        (publishedAt, index) => ({
          source: 'Financial Modeling Prep',
          sourceUrl: `https://example.org/target-${index}`,
          publishedAt,
          firm: index ? 'Latest Firm' : 'Earlier Firm',
          analystName: null,
          targetPrice: index ? 170 : 155,
          currency: null,
          priorTargetPrice: null,
          priceWhenPosted: null,
          rating: null,
          action: null,
          horizon: null,
        })
      ),
    },
    warnings: [],
  };
}

function detail(ticker = 'AAPL'): StockReportAlertDetail {
  return {
    ticker,
    dataAsOf: '2026-10-02',
    lookbackDays: 730,
    decision: 'BUY',
    gateReasons: ['Fresh detail reason'],
    historical: historical(),
    analystTargets: targets(ticker),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function stockBlock(summary: string, ticker: string, decision = 'BUY'): string {
  const remaining = summary.slice(summary.indexOf(`*${ticker} · ${decision}*`));
  const nextStock = /\n\n\*[^\n*]+ · (?:BUY|SELL|HOLD)\*/.exec(remaining)?.index;
  return remaining.slice(0, nextStock);
}

function context(): TickerAnalysisContext {
  const dailyPrices: Candle[] = Array.from({ length: 211 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, 1 + index)),
    open: 100,
    high: 103,
    low: 98,
    close: 101,
    volume: 2_000_000,
  }));
  return {
    result: {
      ticker: 'AAPL',
      date: dailyPrices[210].date.toISOString().slice(0, 10),
      close: 101,
      volume: 2_000_000,
      rsi: 50,
      stochasticK: 50,
      bbLower: 98,
      bbUpper: 103,
      donchLower: 98,
      donchUpper: 103,
      williamsR: -50,
      fearGreed: null,
      patterns: [],
      score: 130,
      opinion: 'BUY',
      atr: 2,
      stopLoss: 98,
      takeProfit: 107,
      trailingStop: 98,
      trailingStart: 102,
      macd: 0,
      macdSignal: 0,
      macdHistogram: 0,
      sma20: 101,
      ema20: 101,
      buyProbability: 90,
      sellProbability: 5,
      holdProbability: 5,
    },
    pipelineResult: {
      ticker: 'AAPL',
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
          passed: true,
          score: 0.8,
          components: { rsSpy: 1, rsSector: 1, vwap: 1, breakoutVol: 1, liquidity: 1, earnings: 0 },
        },
      },
    },
    dailyPrices,
    spyCandles: [],
    sectorCandles: [],
    sectorETF: null,
    config: {
      ...DEFAULT_QUALITY_PIPELINE_CONFIG,
      thresholds: { ...DEFAULT_QUALITY_PIPELINE_CONFIG.thresholds, buy: 123 },
    },
  };
}

function signal(prices: Candle[]): BacktestSignal {
  return {
    ticker: 'AAPL',
    date: prices[205].date,
    close: 101,
    decision: 'BUY',
    score: 130,
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
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('stock report WhatsApp formatting', () => {
  it('reports zero BUY matches and the affected tickers without loading candidate details', async () => {
    const generateReport = vi.fn<StockReportAlertGenerator>();
    const screening = {
      decision: 'BUY' as const,
      analyzed: 197,
      matched: 0,
      unavailable: ['NIVF', 'SXTC', 'DKI'].map((ticker) => ({
        ticker,
        reason: 'Saved risk rejection',
        diagnostics: { code: 'risk-levels-infeasible' as const, rows: 502, close: 0.1, atr: 0.2 },
      })),
    };
    const notification = await buildStockReportWhatsAppNotification(
      { ...input([]), screening },
      { generateReport }
    );

    expect(notification.summary).toContain('BUY 조건 충족 0개 (분석 197개 기준).');
    expect(notification.summary).toContain('손절·목표가 미산정 3종목: DKI, NIVF, SXTC.');
    expect(notification.summary).not.toMatch(/상세 후보 없음|분석 불가|Saved risk/);
    expect(generateReport).not.toHaveBeenCalled();
  });

  it('keeps the decision unknown when none of the requested tickers could be analyzed', () => {
    const notification = formatStockReportWhatsAppNotification(
      {
        ...input([]),
        screening: {
          decision: 'BUY',
          analyzed: 0,
          matched: 0,
          unavailable: [{ ticker: 'FAIL', reason: 'private token=secret' }],
        },
      },
      []
    );

    expect(notification.summary).toContain('BUY');
    expect(notification.summary).toContain('확인할 수 없습니다');
    expect(notification.summary).not.toMatch(/조건 충족 0개|상세 후보 없음|secret/);
  });

  it('leads with the bold stock judgment and groups the financial details', () => {
    const { summary } = formatStockReportWhatsAppNotification(input(), [detail()]);
    expect(summary.split('\n')[0]).toBe('*AAPL · BUY*');
    expect(summary).toContain('\n\n*과거 BUY 순수익 관측*\n승률: 75.00% (3/4)');
    expect(summary).toContain('\n\n*참고 가격 (통화 미제공)*\n종가: 100.00');
    expect(summary).toContain('\n\n*애널리스트 목표가*\n합의: 평균 150.00 USD');
  });

  it('reports observed net wins and sample counts separately from touches and targets', () => {
    const notification = formatStockReportWhatsAppNotification(input(), [detail()]);
    const { summary } = notification;
    expect(summary).toContain('과거 BUY 순수익 관측*\n승률: 75.00% (3/4)');
    expect(summary).toContain('왕복비용 10.00bps');
    expect(summary).toContain('소표본');
    expect(summary).toContain('관측기간: 2024-10-01 ~ 2026-09-25');
    expect(summary).toContain('다음 시가 진입→5거래일 종가 청산');
    expect(summary).toContain('손절 25.00% (1/4) · 목표 50.00% (2/4)');
    expect(summary).toContain('손절·목표선 도달 비율(체결률 아님)');
    expect(summary).toContain('합의: 평균 150.00 USD · 범위 120.00~180.00 · 8명');
    expect(summary).toContain('합의 조회: 2026-10-05 03:30 UTC');
    expect(summary).toContain('https://finance.yahoo.com/quote/AAPL/analysis/');
    expect(summary).toContain('2026-10-04 Latest Firm · 170.00 통화 미제공');
    expect(summary).toContain('https://example.org/target-1');
    expect(summary).not.toContain('Earlier Firm');
    expect(summary).not.toContain('12개월');
    expect(summary).toContain('합의 발표일: 미제공 · 목표기간(합의·개별): 미제공');
  });

  it.each(['2026-10-05T03:30:00', '2026-10-05T13:30:00+10:00', '2026-02-30T03:30:00.000Z'])(
    'preserves non-UTC or invalid consensus retrieval dates: %s',
    (retrievedAt) => {
      const report = detail();
      report.analystTargets!.consensus!.retrievedAt = retrievedAt;
      const { summary } = formatStockReportWhatsAppNotification(input(), [report]);
      expect(summary).toContain(`합의 조회: ${retrievedAt} · Yahoo Finance`);
    }
  );

  it('distinguishes a measured zero from unavailable or zero-sample rates', () => {
    const zero = detail();
    zero.historical = historical();
    zero.historical.fixedHold.wins = 0;
    zero.historical.fixedHold.winRatePct = 0;
    expect(formatStockReportWhatsAppNotification(input(), [zero]).summary).toContain('0.00% (0/4)');
    zero.historical.fixedHold.samples = 0;
    zero.historical.fixedHold.winRatePct = null;
    const noSamples = formatStockReportWhatsAppNotification(input(), [zero]).summary;
    expect(noSamples).toContain('승률: 자료 없음 (표본 0)');
    expect(noSamples).not.toContain('0.00% (0/0)');
    zero.historical.fixedHold.samples = 4;
    expect(formatStockReportWhatsAppNotification(input(), [zero]).summary).toContain(
      '자료 없음 (표본 4)'
    );
  });

  it('keeps the blocking reason and numeric thresholds while translating known gates locally', () => {
    const reasons = [
      'BUY trend gate: Gaussian Channel: filter up, isGreen=true; passed.',
      'BUY score 517.25 / threshold 100; SELL score 9.50 / threshold 75.',
      'Confluence: 3/6; not passed or not evaluated.',
      'Reversal: confirmed; trigger both.',
      'Institutional score 0.875; passed. The institutional strategy blends this score into BUY scoring.',
      'The entry-quality gate rejected this score-qualified BUY setup.',
      'No entry: the complete BUY path did not pass or neither eligible decision qualified.',
    ];
    const original = input([{ ...candidate(), decision: 'HOLD', gateReasons: reasons }]);
    const saved = structuredClone(original);
    const report = { ...detail(), decision: 'HOLD' as const };
    const { summary } = formatStockReportWhatsAppNotification(original, [report]);
    expect(summary).toContain('*AAPL · HOLD*');
    expect(summary).toContain(
      '*원판정 근거*\n• 진입 품질: 매수 점수는 충족했지만 품질 필터가 차단'
    );
    expect(summary).toContain('점수: 매수 517.25/100 · 매도 9.50/75 (점수/기준)');
    expect(summary).toContain('추세: 통과 · 가우시안 채널 상승 · 녹색');
    expect(summary).toContain('지표 일치: 3/6 · 미통과 또는 미평가');
    expect(summary).toContain('반전: 확인 · 양봉·거래량 급증');
    expect(summary).toContain('기관 점수: 0.875 · 통과 (매수 점수 반영)');
    expect(original).toEqual(saved);
  });

  it('keeps the stock details independent of coverage and excludes standalone footer sections', () => {
    const original = {
      ...input(),
      coverageSummary: '분석 19/20 · 일치 5\n반환 4/5 · 일부 생략\nFinviz 부분 수집\u0000',
    };
    const { summary } = formatStockReportWhatsAppNotification(original, [detail()]);
    expect(summary.split('\n')[0]).toBe('*AAPL · BUY*');
    expect(summary).toBe(
      formatStockReportWhatsAppNotification({ ...original, coverageSummary: '' }, [detail()])
        .summary
    );
    expect(summary).not.toContain('*결과 범위*');
    expect(summary).not.toContain('*해석 주의*');
    expect(summary).not.toContain('Finviz 부분 수집');
    expect(summary).not.toContain(String.fromCharCode(0));
  });

  it.each(['SELL', 'HOLD'] as const)(
    'keeps %s decisions and labels history as a BUY cohort',
    (decision) => {
      const original = { ...candidate(), decision };
      const report = { ...detail(), decision };
      const { summary } = formatStockReportWhatsAppNotification(input([original]), [report]);
      expect(summary).toContain(`*AAPL · ${decision}*`);
      expect(summary).toContain(decision === 'SELL' ? '보유 포지션 청산 경고' : '신규 진입 보류');
      expect(summary).toContain('과거 BUY 순수익 관측');
      expect(summary).not.toContain('다음 시가 조건부 진입');
      expect(summary).not.toContain('손절: 97.00 · 목표: 106.00');
    }
  );

  it('preserves the saved decision and refuses historical rates from a different snapshot', () => {
    const changed = { ...detail(), decision: 'HOLD' as const, dataAsOf: '2026-10-03' };
    const { summary } = formatStockReportWhatsAppNotification(input(), [changed]);
    expect(summary).toContain('*AAPL · BUY*');
    expect(summary).toContain('종가일 2026-10-02');
    expect(summary).toContain('재조회: 2026-10-03 HOLD · 원판정 유지');
    expect(summary).toContain('승률: 자료 없음 (과거 BUY 5거래일 순수익)');
    expect(summary).not.toContain('75.00%');
    expect(summary).not.toContain('Fresh detail reason');
    expect(summary).toContain('Trend passed');
    expect(summary).toContain('합의: 평균 150.00 USD');
  });

  it('keeps each of three rich ticker blocks complete within the Unicode character bound', () => {
    const candidates = ['AAPL', 'MSFT', 'NVDA', 'OII'].map((ticker) => ({
      ...candidate(ticker),
      gateReasons: Array.from(
        { length: 6 },
        (_, index) => `${index + 1}. 원판정 gate가 통과했습니다. ${'🤝'.repeat(60)}`
      ),
    }));
    const notification = formatStockReportWhatsAppNotification(
      input(candidates),
      candidates.map((item) => detail(item.ticker))
    );
    expect(notification.summary.length).toBeLessThanOrEqual(3000);
    expect(notification.summary.isWellFormed()).toBe(true);
    expect(notification.summary.match(/\*[A-Z]+ · BUY\*/g)).toHaveLength(3);
    expect(notification.summary).not.toContain('OII');
    for (const ticker of ['AAPL', 'MSFT', 'NVDA']) {
      const block = stockBlock(notification.summary, ticker);
      expect(block).toContain('75.00% (3/4)');
      expect(block).toContain('원판정 근거*\n•');
      expect(block).toContain('합의: 평균 150.00 USD');
      expect(block).toContain('Latest Firm · 170.00');
      expect(block).toContain('합의 조회');
      expect(block).toContain(`https://finance.yahoo.com/quote/${ticker}/analysis/`);
    }
  });

  it('removes unsafe URL metadata and controls without exposing provider failures', () => {
    const report = detail();
    if (!report.analystTargets?.consensus) throw new Error('Fixture missing consensus');
    report.analystTargets.consensus.sourceUrl =
      'https://finance.yahoo.com/quote/AAPL/analysis/?apikey=fixture-private#secret';
    report.analystTargets.recent.updates[1].sourceUrl =
      'https://user:fixture-private@example.org/article';
    report.analystTargets.recent.updates[1].firm = 'Firm\n\u202e injected';
    const original = input([{ ...candidate(), gateReasons: ['Passed\n\u0000\u202e gate'] }]);
    const message = formatStockReportWhatsAppNotification(original, [report]);
    expect(message.summary).toContain('https://finance.yahoo.com/quote/AAPL/analysis/');
    expect(message.summary).not.toContain('fixture-private');
    expect(message.summary).not.toContain('apikey');
    expect(message.summary).not.toContain(String.fromCharCode(0));
    expect(message.summary).not.toContain('\u202e');
    expect(message.summary).toContain('Firm injected');
    expect(message.summary).toContain('Passed gate');
  });

  it('ignores another ticker or lookback report instead of borrowing its statistics', () => {
    const wrongPeriod = { ...detail(), lookbackDays: 2920 };
    expect(formatStockReportWhatsAppNotification(input(), [wrongPeriod]).summary).not.toContain(
      '75.00%'
    );
    const wrongTargets = { ...detail(), analystTargets: targets('MSFT') };
    expect(formatStockReportWhatsAppNotification(input(), [wrongTargets]).summary).toContain(
      '합의: 자료 없음'
    );
  });

  it('keeps essential metrics and original reasons when long URLs must be omitted', () => {
    const candidates = ['AAPL', 'MSFT', 'NVDA'].map((ticker) => ({
      ...candidate(ticker),
      gateReasons: Array.from({ length: 6 }, () => '기관 수급과 추세 원판정 근거 '.repeat(20)),
    }));
    const details = candidates.map((item) => {
      const report = detail(item.ticker);
      if (!report.analystTargets?.consensus) throw new Error('Fixture missing consensus');
      report.analystTargets.consensus.sourceUrl = `https://example.org/${'a'.repeat(1500)}`;
      report.analystTargets.recent.updates[1].sourceUrl = `https://example.org/${'b'.repeat(1500)}`;
      report.analystTargets.recent.updates[1].firm = '긴 금융회사 이름'.repeat(30);
      return report;
    });
    const { summary } = formatStockReportWhatsAppNotification(input(candidates), details);
    expect(summary.length).toBeLessThanOrEqual(3000);
    for (const ticker of ['AAPL', 'MSFT', 'NVDA']) {
      const block = stockBlock(summary, ticker);
      expect(block).toContain('75.00% (3/4)');
      expect(block).toContain('원판정 근거*\n• 기관 수급');
      expect(block).toContain('평균 150.00 USD · 범위 120.00~180.00 · 8명');
      expect(block).toContain('170.00 통화 미제공');
      expect(block).toContain('합의 조회');
      expect(block).toContain('일부 상세·출처는 길이 제한으로 생략');
      expect(block).not.toContain('https://example.org/');
    }
  });

  it('reserves original reasons, net samples and target means with maximum metadata lengths', () => {
    const symbols = ['A', 'B', 'C'].map((letter) => `${letter.repeat(31)}1`);
    const widePrice = 1e20;
    const candidates = symbols.map((ticker) => ({
      ...candidate(ticker),
      gateReasons: [
        `필수원판정근거 ${'추세·기관수급 '.repeat(40)}`,
        `BUY score ${widePrice.toFixed(2)} / threshold ${widePrice}; SELL score ${widePrice.toFixed(2)} / threshold ${widePrice}.`,
        ...Array.from({ length: 5 }, () => '추세·기관수급 '.repeat(40)),
      ],
      reference: { price: widePrice, stopLoss: widePrice, takeProfit: widePrice, atr: widePrice },
    }));
    const reports = symbols.map((ticker) => {
      const report = detail(ticker);
      if (!report.historical || !report.analystTargets?.consensus)
        throw new Error('Fixture incomplete');
      report.historical.fixedHold = {
        samples: Number.MAX_SAFE_INTEGER,
        wins: 0,
        winRatePct: 0,
        averageNetReturnPct: 0,
        rewardRisk: null,
      };
      report.historical.method.roundTripCostBps = Number.MAX_SAFE_INTEGER;
      report.analystTargets.consensus.currency = 'C'.repeat(12);
      report.analystTargets.consensus.mean = widePrice;
      report.analystTargets.consensus.low = widePrice;
      report.analystTargets.consensus.high = widePrice;
      report.analystTargets.consensus.analystCount = Number.MAX_SAFE_INTEGER;
      report.analystTargets.recent.updates[1].firm = 'F'.repeat(60);
      report.analystTargets.recent.updates[1].targetPrice = widePrice;
      report.analystTargets.recent.updates[1].sourceUrl = `https://example.org/${'a'.repeat(1500)}`;
      return report;
    });
    const original = {
      ...input(candidates),
      coverageSummary: `${'전체 분석 범위 기록 '.repeat(100)}\n${'추가 수집 범위 기록 '.repeat(100)}`,
      screening: {
        decision: 'BUY' as const,
        analyzed: 3,
        matched: 3,
        unavailable: Array.from({ length: 60 }, (_, index) => ({
          ticker: `UNAVAILABLE${index}`,
          reason: 'private provider response',
          diagnostics: {
            code: (
              ['risk-levels-infeasible', 'invalid-price-or-atr', 'history-unavailable'] as const
            )[index % 3],
            rows: 100,
          },
        })),
      },
    };
    const { summary } = formatStockReportWhatsAppNotification(original, reports);
    expect(summary.length).toBeLessThanOrEqual(3000);
    expect(summary).not.toContain('전체 분석 범위 기록');
    expect(summary).toContain('손절·목표가 미산정 20종목');
    expect(summary).toContain('가격 이력');
    expect(summary).not.toContain('private provider response');
    for (const ticker of symbols) {
      const block = stockBlock(summary, ticker);
      expect(block).toContain('원판정 근거*\n• 필수원판정근거');
      expect(block).toContain(`0.00% (0/${Number.MAX_SAFE_INTEGER})`);
      expect(block).toContain(`합의: 평균 ${widePrice.toFixed(2)} ${'C'.repeat(12)}`);
      expect(block).toContain(`종가: ${widePrice.toFixed(2)}`);
      expect(block).toContain(`목표: ${widePrice.toFixed(2)}`);
      expect(block).toContain('관측기간: 2024-10-01 ~ 2026-09-25');
      expect(block).toContain('다음 시가 진입→5거래일 종가 청산');
      expect(block).toContain(`왕복비용 ${Number.MAX_SAFE_INTEGER.toFixed(2)}bps`);
      expect(block).toContain(`점수: 매수 ${widePrice.toFixed(2)}/${widePrice}`);
      expect(block).toContain('합의 조회: 2026-10-05 03:30 UTC');
      expect(block).toContain('일부 상세·출처는 길이 제한으로 생략');
    }
  });
});

describe('bounded stock report enrichment', () => {
  it('reuses the actual CLI context and configuration without fetching another analysis', async () => {
    const originalContext = context();
    vi.mocked(runSignalsWithContext).mockReturnValue([signal(originalContext.dailyPrices)]);
    vi.mocked(getAnalystTargets).mockResolvedValue(targets());
    const original = {
      ...candidate(),
      dataAsOf: originalContext.result.date,
      context: originalContext,
    };
    const message = await buildStockReportWhatsAppNotification({
      ...input([original]),
      pipelineConfig: {
        ...structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG),
        thresholds: { buy: 300, sell: 130 },
      },
    });
    expect(analyzeTickerContext).not.toHaveBeenCalled();
    expect(getAnalystTargets).toHaveBeenCalledExactlyOnceWith('AAPL');
    expect(runSignalsWithContext).toHaveBeenCalledWith(
      expect.anything(),
      'AAPL',
      originalContext.config
    );
    expect(vi.mocked(runSignalsWithContext).mock.calls[0][2]).toBe(originalContext.config);
    expect(message.summary).toContain('100.00% (1/1)');
    expect(message.summary).toContain('관측기간: 2025-07-26 ~ 2025-07-26');
    expect(message.summary).toContain('왕복비용 10.00bps');
    expect(message.summary).not.toContain('가격 출처 Yahoo Finance');
  });

  it('uses the same requested lookback for lean context loading and retains history if targets fail', async () => {
    const originalContext = context();
    vi.mocked(analyzeTickerContext).mockResolvedValue(originalContext);
    vi.mocked(runSignalsWithContext).mockReturnValue([signal(originalContext.dailyPrices)]);
    vi.mocked(getAnalystTargets).mockRejectedValue(new Error('fixture-private-target-api-token'));
    const original = { ...candidate(), dataAsOf: originalContext.result.date };
    const message = await buildStockReportWhatsAppNotification(input([original]));
    expect(analyzeTickerContext).toHaveBeenCalledExactlyOnceWith('AAPL', null, {
      lookbackDays: 730,
    });
    expect(message.summary).toContain('100.00% (1/1)');
    expect(message.summary).toContain('합의: 자료 없음');
    expect(message.summary).not.toContain('fixture-private');
  });

  it('refuses an unrelated supplied context without starting provider work', async () => {
    const mismatched = { ...candidate(), context: context() };
    await buildStockReportWhatsAppNotification(input([mismatched]));
    expect(analyzeTickerContext).not.toHaveBeenCalled();
    expect(getAnalystTargets).not.toHaveBeenCalled();
    expect(runSignalsWithContext).not.toHaveBeenCalled();
  });

  it('enriches saved screening history with its frozen complete config after active settings change', async () => {
    const originalContext = context();
    const savedConfig = structuredClone(originalContext.config);
    const frozenCopy = structuredClone(savedConfig);
    const activeConfig = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    activeConfig.thresholds.buy = 300;
    vi.mocked(analyzeTickerContext).mockImplementation(async (_ticker, _sentiment, options) => ({
      ...originalContext,
      config: structuredClone(options?.pipelineConfig ?? activeConfig),
    }));
    vi.mocked(runSignalsWithContext).mockImplementation((_context, _ticker, config) =>
      config.thresholds.buy === frozenCopy.thresholds.buy
        ? [signal(originalContext.dailyPrices)]
        : []
    );
    vi.mocked(getAnalystTargets).mockResolvedValue(targets());
    const original = { ...candidate(), dataAsOf: originalContext.result.date };
    const pending = buildStockReportWhatsAppNotification({
      ...input([original]),
      pipelineConfig: savedConfig,
    });
    // A caller or optimizer may change settings while bounded enrichment awaits providers.
    savedConfig.thresholds.buy = 275;
    activeConfig.institutional.weights.rsSpy = 0.9;
    const message = await pending;

    expect(analyzeTickerContext).toHaveBeenCalledExactlyOnceWith('AAPL', null, {
      lookbackDays: 730,
      pipelineConfig: frozenCopy,
    });
    expect(vi.mocked(analyzeTickerContext).mock.calls[0][2]?.pipelineConfig).not.toBe(savedConfig);
    expect(runSignalsWithContext).toHaveBeenCalledWith(expect.anything(), 'AAPL', frozenCopy);
    expect(message.summary).toContain('100.00% (1/1)');
    expect(message.summary).not.toContain('표본 0');
  });

  it('isolates each generator snapshot without mutating the saved scan or the next candidate', async () => {
    const savedConfig = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    const preserved = structuredClone(savedConfig);
    const snapshots: number[] = [];
    const generateReport = vi.fn<StockReportAlertGenerator>(async (ticker, options) => {
      snapshots.push(options.pipelineConfig!.thresholds.buy);
      options.pipelineConfig!.thresholds.buy = 333;
      options.pipelineConfig!.institutional.weights.rsSpy = 0.9;
      return detail(ticker);
    });
    await buildStockReportWhatsAppNotification(
      { ...input([candidate('AAPL'), candidate('MSFT')]), pipelineConfig: savedConfig },
      { generateReport }
    );
    expect(snapshots).toEqual([preserved.thresholds.buy, preserved.thresholds.buy]);
    expect(savedConfig).toEqual(preserved);
    expect(generateReport.mock.calls[0][1].pipelineConfig).not.toBe(
      generateReport.mock.calls[1][1].pipelineConfig
    );
  });

  it('starts only three sequential ticker jobs with the exact requested lookback', async () => {
    vi.useFakeTimers();
    let active = 0;
    let maximum = 0;
    const generateReport = vi.fn<StockReportAlertGenerator>(async (ticker) => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return detail(ticker);
    });
    const original = input(['AAPL', 'MSFT', 'NVDA', 'OII'].map((ticker) => candidate(ticker)));
    const saved = structuredClone(original);
    const pending = buildStockReportWhatsAppNotification(original, { generateReport });
    await vi.advanceTimersByTimeAsync(15);
    const result = await pending;
    expect(generateReport.mock.calls.map(([ticker]) => ticker)).toEqual(['AAPL', 'MSFT', 'NVDA']);
    expect(generateReport.mock.calls.every(([, options]) => options.lookbackDays === 730)).toBe(
      true
    );
    expect(maximum).toBe(1);
    expect(result.summary).toContain('75.00% (3/4)');
    expect(original).toEqual(saved);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops launching at the shared deadline and cannot be mutated by a late result', async () => {
    vi.useFakeTimers();
    const late = deferred<StockReportAlertDetail>();
    const generateReport = vi.fn<StockReportAlertGenerator>(() => late.promise);
    const pending = buildStockReportWhatsAppNotification(input([candidate(), candidate('MSFT')]), {
      generateReport,
      timeBudgetMs: 20,
    });
    await vi.advanceTimersByTimeAsync(20);
    const result = await pending;
    const saved = structuredClone(result);
    expect(generateReport).toHaveBeenCalledTimes(1);
    expect(result.summary).toContain('종가: 100.00');
    expect(result.summary).toContain('자료 없음');
    late.resolve(detail());
    await Promise.resolve();
    expect(result).toEqual(saved);
    expect(generateReport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves cheap event facts when enrichment throws and exposes no raw error', async () => {
    const generateReport = vi
      .fn<StockReportAlertGenerator>()
      .mockRejectedValue(new Error('fixture-private-token provider error'));
    const message = await buildStockReportWhatsAppNotification(input(), { generateReport });
    expect(message.summary).toContain('*AAPL · BUY*');
    expect(message.summary).toContain('손절: 97.00 · 목표: 106.00');
    expect(message.summary).toContain('Trend passed');
    expect(message.summary).not.toContain('fixture-private');
  });

  it('makes no requests for empty candidates or invalid source metadata', async () => {
    const generateReport = vi.fn<StockReportAlertGenerator>();
    const noCandidates = await buildStockReportWhatsAppNotification(input([]), { generateReport });
    expect(noCandidates.summary).toBe('상세 후보 없음.');
    await buildStockReportWhatsAppNotification(input([candidate('AAPL/api?token=secret')]), {
      generateReport,
    });
    await buildStockReportWhatsAppNotification(
      { ...input(), lookbackDays: 30 },
      { generateReport }
    );
    expect(generateReport).not.toHaveBeenCalled();
  });
});
