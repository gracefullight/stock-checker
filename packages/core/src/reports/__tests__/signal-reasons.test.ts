import { describe, expect, it } from 'vitest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import { gateReasons } from '@/reports/signal-reasons';
import type { TickerAnalysisContext } from '@/services/ticker-analysis';
import type { PipelineResult } from '@/types';

function context(pipelineResult: Partial<PipelineResult>): TickerAnalysisContext {
  const signal: PipelineResult = {
    ticker: 'TEST',
    finalDecision: 'HOLD',
    score: 250,
    buyScore: 250,
    sellScore: 10,
    confidence: 0,
    gateResults: {
      trend: {
        passed: true,
        regime: 'uptrend',
        strength: 100,
        reason: 'Gaussian Channel: filter up, isGreen=true',
      },
      confluence: { passed: false, activeIndicators: 0, totalIndicators: 6, ratio: 0 },
      reversal: { status: 'rejected', trigger: null },
      institutional: {
        score: 0.4,
        passed: false,
        components: { rsSpy: 1, rsSector: 1, vwap: 0, breakoutVol: 0, liquidity: 1, earnings: 0.3 },
      },
    },
    ...pipelineResult,
  };
  return {
    result: { ticker: 'TEST' } as TickerAnalysisContext['result'],
    pipelineResult: signal,
    dailyPrices: [],
    spyCandles: [],
    sectorCandles: [],
    sectorETF: 'XLK',
    config: structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG),
  };
}

describe('gateReasons', () => {
  it('leads a HOLD with the blocking gate and its failed clause values', () => {
    const reasons = gateReasons(
      context({
        blockedBy: 'quality',
        qualityBlocked: true,
        checks: [
          {
            gate: 'trend',
            id: 'filter-direction',
            passed: true,
            value: 'up',
            limit: 'up|flat',
            comparator: 'in',
          },
          {
            gate: 'score',
            id: 'buy-score',
            passed: true,
            value: 250,
            limit: 200,
            comparator: '>=',
          },
          { gate: 'quality', id: 'ibs', passed: false, value: 0.34, limit: 0.2, comparator: '<' },
          {
            gate: 'quality',
            id: 'rs-sector',
            passed: true,
            value: 1,
            limit: 0.7,
            comparator: '>=',
          },
        ],
      })
    );
    expect(reasons[0]).toBe('HOLD: blocked by entry-quality gate; IBS 0.34 < 0.20 (failed).');
    expect(reasons[0].startsWith('BUY')).toBe(false);
    expect(reasons).toContain(
      'Entry quality: IBS 0.34 < 0.20 (failed); RS vs sector 1 >= 0.70 (ok).'
    );
    // Parser-compatible legacy lines stay intact.
    expect(reasons).toContain('BUY trend gate: Gaussian Channel: filter up, isGreen=true; passed.');
    expect(reasons).toContain(
      'BUY score 250.00 / threshold 200; SELL score 10.00 / threshold 130.'
    );
    expect(reasons).toContain('The entry-quality gate rejected this score-qualified BUY setup.');
    // Disabled reversal/confidence gates and the unevaluated confluence gate render nothing.
    expect(reasons.some((reason) => /^(Reversal|Confidence|Confluence):/.test(reason))).toBe(false);
  });

  it('describes a cluster block with the last setup and next eligible dates', () => {
    const reasons = gateReasons(
      context({
        blockedBy: 'cluster',
        cluster: {
          lastSetupDate: '2026-10-01',
          nextEligibleDate: '2026-10-06',
          gapUnit: 'calendar',
          minGap: 5,
        },
        checks: [
          { gate: 'cluster', id: 'min-gap', passed: false, value: 3, limit: 5, comparator: '>=' },
        ],
      })
    );
    expect(reasons[0]).toBe(
      'HOLD: blocked by cluster filter (an earlier setup already consumed this window); last setup 2026-10-01, next eligible 2026-10-06 (5 calendar days).'
    );
    expect(reasons).toContain('Cluster: gap since last setup 3 days >= 5 days (failed).');
  });

  it('keeps the BUY headline only for an actual BUY and lists evaluated gates', () => {
    const reasons = gateReasons(
      context({
        finalDecision: 'BUY',
        checks: [
          {
            gate: 'confluence',
            id: 'active-indicators',
            passed: true,
            value: 2,
            limit: 1,
            comparator: '>=',
          },
        ],
      })
    );
    expect(reasons[0]).toBe(
      'BUY qualifies at the completed close; execution remains conditional on the next session open.'
    );
    expect(reasons).toContain('Confluence: active oscillators 2 >= 1 (ok).');
  });

  it('explains the unvalidated short-history path', () => {
    const reasons = gateReasons(
      context({
        blockedBy: 'insufficient-history',
        checks: [
          {
            gate: 'insufficient-history',
            id: 'sessions',
            passed: false,
            value: 120,
            limit: 210,
            comparator: '>=',
          },
        ],
      })
    );
    expect(reasons[0]).toBe(
      'HOLD: blocked by insufficient history (fewer than 210 sessions; unvalidated path); sessions of history 120 >= 210 (failed).'
    );
  });
});
