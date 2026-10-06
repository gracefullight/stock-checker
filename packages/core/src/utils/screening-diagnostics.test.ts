import { describe, expect, it } from 'vitest';
import type { MarketScreenJob } from '@/reports/market-screen';
import type { TickerAnalysisUnavailable } from '@/services/ticker-analysis';
import {
  describeAnalysisUnavailable,
  formatMarketScreenTitle,
  formatScreenEvaluation,
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
    ).toBe('유효한 종가 또는 ATR 데이터를 확인할 수 없습니다.');
    const risk = describeAnalysisUnavailable({
      code: 'risk-levels-infeasible',
      rows: 1000,
      close: 4,
      atr: 8,
    });
    expect(risk).toBe('유효한 ATR 기준 손절·목표 가격을 산정할 수 없습니다.');
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
      '평가 1/2 · 분석 불가 1'
    );
    expect(formatScreenEvaluation({ total: 2, analyzed: 0, unavailable: 2 })).toBe(
      '평가 0/2 · 분석 불가 2'
    );
    expect(formatScreenEvaluation({ total: 2, analyzed: 1, unavailable: 0 })).toBe('평가 1/2');
  });

  it('keeps a capped source range distinct from successful candidate evaluation', () => {
    const job = marketJob();
    const original = structuredClone(job);
    expect(formatMarketScreenTitle(job)).toBe(
      '시장 후보 스크리닝 · BUY · 평가 완료 200/200 · Finviz 후보 200/4000'
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
      '시드니 아침 스크리닝 · ALL · 평가 199/200 · 분석 불가 1 · Finviz 후보 200/200'
    );
  });

  it('does not label pending evaluation as failure or complete based on job status', () => {
    const job = marketJob();
    job.status = 'paused';
    job.progress.analyzed = 2;
    job.progress.pending = 198;
    expect(formatMarketScreenTitle(job)).toBe(
      '시장 후보 스크리닝 · BUY · 평가 2/200 · Finviz 후보 200/4000'
    );
  });
});
