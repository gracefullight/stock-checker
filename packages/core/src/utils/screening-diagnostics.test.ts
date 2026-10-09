import { describe, expect, it } from 'vitest';
import type { MarketScreenJob } from '@/reports/market-screen';
import type { TickerAnalysisUnavailable } from '@/services/ticker-analysis';
import {
  describeAnalysisUnavailable,
  formatMarketScreenTitle,
  formatScreenDecision,
  formatScreenEvaluation,
  formatScreeningOutcome,
  type ScreenAnalysisUnavailable,
} from '@/utils/screening-diagnostics';

function marketJob(): MarketScreenJob {
  return {
    schemaVersion: 1,
    id: 'fixture',
    status: 'partial',
    createdAt: '2026-10-06T04:00:00.000Z',
    updatedAt: '2026-10-06T04:05:00.000Z',
    startedAt: '2026-10-06T04:00:00.000Z',
    finishedAt: '2026-10-06T04:05:00.000Z',
    pauseReason: null,
    universe: {
      source: 'finviz-candidates',
      url: 'https://finviz.com/screener.ashx',
      filters: ['stocks-only', 'below-SMA50'],
      sourceTotal: 4000,
      collectedCount: 200,
      inputCount: 200,
      capturedAt: '2026-10-06T04:00:00.000Z',
      completeness: 'partial',
      overallTotal: null,
      pages: 1,
    },
    criteria: {
      decision: 'BUY',
      lookbackDays: 2920,
      engine: 'Fixture engine',
      concurrency: 2,
      minIntervalMs: 2000,
    },
    progress: {
      total: 200,
      analyzed: 200,
      unavailable: 0,
      pending: 0,
      inFlight: 0,
      matched: 3,
      excluded: 197,
    },
    warnings: [],
  };
}

describe('screening diagnostics', () => {
  it('distinguishes missing history, invalid prices and infeasible risk levels', () => {
    const history: ScreenAnalysisUnavailable = {
      ticker: 'NEW',
      reason: 'Legacy generic reason',
      diagnostics: { code: 'history-unavailable', rows: 1 },
    };
    expect(describeAnalysisUnavailable(history.diagnostics)).toBe(
      '완료된 거래일의 가격 이력을 가져올 수 없습니다.'
    );
    expect(
      describeAnalysisUnavailable({
        code: 'invalid-price-or-atr',
        rows: 1000,
        close: Number.NaN,
        atr: 0,
      })
    ).toBe('유효한 종가 또는 평균 가격 변동폭을 확인할 수 없습니다.');
    const risk = describeAnalysisUnavailable({
      code: 'risk-levels-infeasible',
      rows: 1000,
      close: 4,
      atr: 8,
    });
    expect(risk).toBe('평균 가격 변동폭 기준으로 유효한 손절·목표가를 산정할 수 없습니다.');
    expect(risk).not.toMatch(/이력|조회|부족|0 이하/);
  });

  it('uses a fixed fallback without leaking unrecognized diagnostics', () => {
    const fallback = '완료된 거래일 기준 분석을 사용할 수 없습니다.';
    expect(describeAnalysisUnavailable(undefined)).toBe(fallback);
    expect(
      describeAnalysisUnavailable({
        code: 'private-provider-error',
        rows: 0,
      } as unknown as TickerAnalysisUnavailable)
    ).toBe(fallback);
  });

  it('marks only a fully successful evaluation complete, including a genuine empty set', () => {
    expect(formatScreenEvaluation({ total: 2, analyzed: 2, unavailable: 0 })).toBe('평가 완료 2/2');
    expect(formatScreenEvaluation({ total: 0, analyzed: 0, unavailable: 0 })).toBe('평가 완료 0/0');
    expect(formatScreenEvaluation({ total: 2, analyzed: 1, unavailable: 1 })).toBe(
      '평가 1/2 · 미산정 1종목'
    );
    expect(formatScreenEvaluation({ total: 2, analyzed: 0, unavailable: 2 })).toBe(
      '평가 0/2 · 미산정 2종목'
    );
    expect(formatScreenEvaluation({ total: 2, analyzed: 1, unavailable: 0 })).toBe('평가 1/2');
  });

  it('keeps a capped source range distinct from successful candidate evaluation', () => {
    const job = marketJob();
    const original = structuredClone(job);
    expect(formatMarketScreenTitle(job)).toBe(
      '시장 후보 스크리닝 · BUY 3개 · 평가 완료 200/200 · Finviz 후보 200/4000'
    );
    expect(job).toEqual(original);
  });

  it('reports real analysis failures even when Finviz collection is complete', () => {
    const job = marketJob();
    job.status = 'completed';
    job.universe.sourceTotal = 200;
    job.universe.completeness = 'complete';
    job.criteria.decision = 'ALL';
    job.progress.analyzed = 199;
    job.progress.unavailable = 1;
    expect(formatMarketScreenTitle(job, '시드니 아침 스크리닝')).toBe(
      '시드니 아침 스크리닝 · ALL · 일치 3개 · 평가 199/200 · 미산정 1종목 · Finviz 후보 200/200'
    );
  });

  it('does not label pending evaluation as failure or complete based on job status', () => {
    const job = marketJob();
    job.status = 'paused';
    job.progress.analyzed = 2;
    job.progress.pending = 198;
    expect(formatMarketScreenTitle(job)).toBe(
      '시장 후보 스크리닝 · BUY 3개 · 평가 2/200 · Finviz 후보 200/4000'
    );
  });

  it('leads with the observed BUY result and explains the three missing risk levels', () => {
    const unavailable: ScreenAnalysisUnavailable[] = ['SXTC', 'NIVF', 'DKI'].map((ticker) => ({
      ticker,
      reason: 'legacy reason',
      diagnostics: { code: 'risk-levels-infeasible', rows: 1000, close: 0.081, atr: 0.144 },
    }));
    expect(
      formatScreeningOutcome({ decision: 'BUY', analyzed: 197, matched: 0, unavailable })
    ).toBe('BUY 조건 충족 0개 (분석 197개 기준).\n손절·목표가 미산정 3종목: DKI, NIVF, SXTC.');
    const job = marketJob();
    job.progress.analyzed = 197;
    job.progress.matched = 0;
    job.progress.unavailable = 3;
    expect(formatMarketScreenTitle(job)).toBe(
      '시장 후보 스크리닝 · BUY 0개 · 평가 197/200 · 미산정 3종목 · Finviz 후보 200/4000'
    );
  });

  it('groups risk and price failures and limits sorted examples to five tickers', () => {
    const unavailable: ScreenAnalysisUnavailable[] = Array.from({ length: 17 }, (_, index) => ({
      ticker: `T${String(17 - index).padStart(2, '0')}`,
      reason: 'legacy reason',
      diagnostics: { code: 'risk-levels-infeasible', rows: 1000 },
    }));
    unavailable.push({
      ticker: 'BAD',
      reason: 'legacy reason',
      diagnostics: { code: 'invalid-price-or-atr', rows: 1000 },
    });
    expect(
      formatScreeningOutcome({ decision: 'SELL', analyzed: 182, matched: 2, unavailable })
    ).toBe(
      'SELL 조건 충족 2개 (분석 182개 기준).\n손절·목표가 미산정 17종목: T01, T02, T03, T04, T05 외 12종목.\n종가·변동폭 확인 불가 1종목: BAD.'
    );
  });

  it('does not claim no matches when every analysis failed', () => {
    const unavailable: ScreenAnalysisUnavailable[] = [
      {
        ticker: 'NEW',
        reason: 'legacy reason',
        diagnostics: { code: 'history-unavailable', rows: 1 },
      },
    ];
    expect(formatScreeningOutcome({ decision: 'BUY', analyzed: 0, matched: 0, unavailable })).toBe(
      '분석 결과가 없어 BUY 조건 충족 여부를 확인할 수 없습니다.\n가격 이력 미확보 1종목: NEW.'
    );
    expect(formatScreeningOutcome({ decision: 'ALL', analyzed: 0, matched: 0, unavailable })).toBe(
      '분석 결과를 확인할 수 없습니다.\n가격 이력 미확보 1종목: NEW.'
    );
    expect(formatScreenDecision({ decision: 'BUY', analyzed: 0, matched: 0, total: 1 })).toBe(
      'BUY 확인 불가'
    );
    expect(formatScreenDecision({ decision: 'ALL', analyzed: 0, matched: 0, total: 1 })).toBe(
      'ALL · 확인 불가'
    );
    const job = marketJob();
    job.progress.analyzed = 0;
    job.progress.matched = 0;
    job.progress.unavailable = 200;
    expect(formatMarketScreenTitle(job)).toBe(
      '시장 후보 스크리닝 · BUY 확인 불가 · 평가 0/200 · 미산정 200종목 · Finviz 후보 200/4000'
    );
  });

  it('reports a genuine empty universe and successful ALL analyses without failure language', () => {
    expect(
      formatScreeningOutcome({ decision: 'BUY', analyzed: 0, matched: 0, unavailable: [] })
    ).toBe('BUY 조건 충족 0개 (분석 0개 기준).');
    expect(formatScreenDecision({ decision: 'BUY', analyzed: 0, matched: 0, total: 0 })).toBe(
      'BUY 0개'
    );
    expect(
      formatScreeningOutcome({ decision: 'ALL', analyzed: 9, matched: 9, unavailable: [] })
    ).toBe('분석 결과 9개.');
    expect(formatScreenDecision({ decision: 'ALL', analyzed: 9, matched: 9, total: 9 })).toBe(
      'ALL · 일치 9개'
    );
  });

  it('never exposes raw reasons or unknown provider diagnostic strings', () => {
    const unavailable: ScreenAnalysisUnavailable[] = [
      { ticker: 'OLD', reason: 'secret-token=https://private.example/credential' },
      {
        ticker: 'PROVIDER',
        reason: 'private transport failure',
        diagnostics: {
          code: 'private-provider-secret',
          rows: 0,
        } as unknown as TickerAnalysisUnavailable,
      },
    ];
    const result = formatScreeningOutcome({
      decision: 'HOLD',
      analyzed: 4,
      matched: 1,
      unavailable,
    });
    expect(result).toBe(
      'HOLD 조건 충족 1개 (분석 4개 기준).\n데이터 확인 불가 2종목: OLD, PROVIDER.'
    );
    expect(result).not.toMatch(/secret|private|credential|transport|https/);
  });

  it('bounds all cause groups and suppresses hostile ticker text', () => {
    const codes = [
      'risk-levels-infeasible',
      'history-unavailable',
      'invalid-price-or-atr',
      'unknown',
    ] as const;
    const unavailable: ScreenAnalysisUnavailable[] = codes.flatMap((code) =>
      Array.from({ length: 20 }, (_, index) => ({
        ticker:
          index < 5
            ? `ABCDEFGHIJ${String(index).padStart(2, '0')}`
            : 'secret\n*BUY* https://x.test',
        reason: 'secret provider payload',
        diagnostics: { code, rows: 0 } as unknown as TickerAnalysisUnavailable,
      }))
    );
    const result = formatScreeningOutcome({
      decision: 'BUY',
      analyzed: Number.MAX_SAFE_INTEGER,
      matched: Number.MAX_SAFE_INTEGER,
      unavailable,
    });
    expect(result.length).toBeLessThanOrEqual(600);
    expect(result.split('\n')).toHaveLength(5);
    expect(result.match(/외 15종목/g)).toHaveLength(4);
    expect(result).not.toMatch(/secret|https|\*/);
    expect(result).not.toContain('ABCDEFGHIJ05');
  });
});
