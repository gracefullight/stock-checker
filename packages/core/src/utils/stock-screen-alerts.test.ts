import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import type { StockScreenMatch, StockScreenResult } from '@/reports/stock-screen';
import type { StockReportAlertGenerator } from '@/utils/stock-report-alerts';
import {
  buildStockScreenReportNotification,
  buildStockScreenWhatsAppNotification,
  formatScreenTimestamp,
} from '@/utils/stock-screen-alerts';

function candidate(ticker: string, overrides: Partial<StockScreenMatch> = {}): StockScreenMatch {
  return {
    ticker,
    dataAsOf: '2026-10-02',
    decision: 'BUY',
    score: 300,
    buyScore: 300,
    sellScore: 10,
    gates: {
      trend: { passed: true, regime: 'uptrend', strength: 1, reason: 'Fixture uptrend' },
      confluence: { passed: true, activeIndicators: 5, totalIndicators: 6, ratio: 5 / 6 },
      reversal: { status: 'confirmed', trigger: 'both' },
      institutional: {
        passed: true,
        score: 1,
        components: { rsSpy: 1, rsSector: 1, vwap: 1, breakoutVol: 1, liquidity: 1, earnings: 1 },
      },
    },
    gateReasons: ['Fixture gates passed'],
    execution: {
      entry: { status: 'conditional', timing: 'next-session-open', price: null, eligible: true },
      reference: {
        basis: 'latest-completed-close',
        price: 123.456,
        atr: 2,
        stopLoss: 120,
        takeProfit: 130,
        trailingStop: 121,
        trailingStart: 125,
      },
    },
    rsi: 55,
    sector: 'Technology',
    ...overrides,
  };
}

function fixture(overrides: Partial<StockScreenResult> = {}): StockScreenResult {
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-05T03:30:00.000Z',
    status: 'available',
    universe: { source: 'provided', tickers: ['AAPL'] },
    criteria: {
      decision: 'BUY',
      lookbackDays: 730,
      limit: 20,
      timeBudgetMs: 45000,
      engine: 'Fixture final decisions',
      pipelineConfig: structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG),
      sort: { metric: 'buyScore', order: 'descending', tieBreaker: 'ticker-ascending' },
    },
    coverage: {
      requested: 1,
      analyzed: 1,
      unavailable: 0,
      matched: 1,
      returned: 1,
      truncated: false,
    },
    decisionCounts: { BUY: 1, SELL: 0, HOLD: 0 },
    matches: [candidate('AAPL')],
    excluded: [],
    unavailable: [],
    warnings: ['Fixture scores are not win probabilities.'],
    ...overrides,
  };
}

describe('buildStockScreenWhatsAppNotification', () => {
  it('formats known UTC scan times to minutes and preserves unknown timestamp inputs', () => {
    expect(formatScreenTimestamp('2026-10-05T03:30:42.123Z')).toBe('2026-10-05 03:30 UTC');
    expect(formatScreenTimestamp('2026-02-30T03:30:42.123Z')).toBe('2026-02-30T03:30:42.123Z');
    expect(formatScreenTimestamp('2026-10-05T03:30:00+11:00')).toBe('2026-10-05T03:30:00+11:00');
    expect(formatScreenTimestamp('unknown')).toBe('unknown');
  });
  it('enriches the original snapshot with the screening history window and preserved reasons', async () => {
    const screen = fixture({ criteria: { ...fixture().criteria, lookbackDays: 2920 } });
    const original = structuredClone(screen);
    const generateReport = vi.fn<StockReportAlertGenerator>(async (ticker, options) => ({
      ticker,
      lookbackDays: options.lookbackDays,
      dataAsOf: '2026-10-05',
      decision: 'SELL',
      gateReasons: ['New unrelated decision'],
      historical: null,
      analystTargets: null,
    }));
    const message = await buildStockScreenReportNotification(screen, { generateReport });

    expect(generateReport).toHaveBeenCalledExactlyOnceWith('AAPL', {
      lookbackDays: 2920,
      pipelineConfig: screen.criteria.pipelineConfig,
    });
    expect(message.summary).toContain('*AAPL · BUY*');
    expect(message.summary).toContain('2026-10-02');
    expect(message.summary).toContain('Fixture gates passed');
    expect(message.summary).not.toContain('New unrelated decision');
    expect(screen).toEqual(original);
  });

  it('does not start report data requests while timed-out screen providers can remain in progress', async () => {
    const screen = fixture({
      status: 'partial',
      unavailable: [
        {
          ticker: 'SLOW',
          reason: 'Screen time budget exhausted while ticker analysis was in progress.',
        },
      ],
    });
    const generateReport = vi.fn<StockReportAlertGenerator>(async () => {
      throw new Error('Overlapping provider requests are forbidden');
    });
    const message = await buildStockScreenReportNotification(screen, { generateReport });
    expect(generateReport).not.toHaveBeenCalled();
    expect(message.summary).toContain('*AAPL · BUY*');
    expect(message.summary).toContain('Fixture gates passed');
  });

  it('distinguishes scan completion from per-ticker completed bars and reference prices', () => {
    const first = candidate('AAPL');
    const second = candidate('OII', { dataAsOf: '2026-10-01' });
    const screen = fixture({ matches: [first, second] });
    const original = structuredClone(screen);
    const message = buildStockScreenWhatsAppNotification(screen);

    expect(message.title).toBe('종목 스크리닝 · BUY · 평가 완료 1/1');
    expect(message.asOf).toBe('검색 완료 2026-10-05 03:30 UTC');
    expect(message.summary).toContain('AAPL BUY · 종가일 2026-10-02 · 참고 123.46');
    expect(message.summary).toContain('OII BUY · 종가일 2026-10-01 · 참고 123.46');
    expect(message.summary).not.toMatch(/필터|분석|알림|해석 주의|결과 범위|승률/);
    expect(message.summary).not.toContain('300');
    expect(screen).toEqual(original);
  });

  it('limits alerts to three candidates while keeping full coverage in the structured screen', () => {
    const matches = ['AAPL', 'MSFT', 'NVDA', 'OII', 'SPCX'].map((ticker) => candidate(ticker));
    const screen = fixture({
      criteria: { ...fixture().criteria, limit: 5 },
      coverage: {
        requested: 20,
        analyzed: 19,
        unavailable: 1,
        matched: 8,
        returned: 5,
        truncated: true,
      },
      status: 'partial',
      matches,
    });
    const { summary, title } = buildStockScreenWhatsAppNotification(screen);

    expect(screen.coverage).toEqual({
      requested: 20,
      analyzed: 19,
      unavailable: 1,
      matched: 8,
      returned: 5,
      truncated: true,
    });
    expect(screen.criteria.limit).toBe(5);
    expect(title).toBe('종목 스크리닝 · BUY · 평가 19/20 · 분석 불가 1');
    expect(summary).not.toMatch(/필터|분석|알림|반환|생략|해석 주의|결과 범위/);
    expect(summary).toContain('AAPL BUY');
    expect(summary).toContain('MSFT BUY');
    expect(summary).toContain('NVDA BUY');
    expect(summary).not.toMatch(/OII|SPCX/);
    expect(summary.length).toBeLessThanOrEqual(700);
  });

  it.each(['available', 'unavailable'] as const)(
    'describes actual %s evaluation counts when no candidates were returned',
    (status) => {
      const unavailable = status === 'unavailable' ? 2 : 0;
      const message = buildStockScreenWhatsAppNotification(
        fixture({
          status,
          matches: [],
          coverage: {
            requested: 2,
            analyzed: 2 - unavailable,
            unavailable,
            matched: 0,
            returned: 0,
            truncated: false,
          },
        })
      );
      const { summary } = message;
      expect(message.title).toContain(
        status === 'available' ? '평가 완료 2/2' : '평가 0/2 · 분석 불가 2'
      );
      expect(summary).toBe('일치 종목 없음.');
      expect(summary).not.toMatch(/win rate|%/i);
    }
  );

  it('preserves the requested decision filter and shows missing session or reference data explicitly', () => {
    const base = candidate('OII', { decision: 'HOLD', dataAsOf: null });
    base.execution.reference = null;
    const message = buildStockScreenWhatsAppNotification(
      fixture({
        criteria: { ...fixture().criteria, decision: 'ALL' },
        matches: [base],
      })
    );
    expect(message.title).toBe('종목 스크리닝 · ALL · 평가 완료 1/1');
    expect(message.summary).toContain('OII HOLD · 종가일 자료 없음 · 참고 자료 없음');
    expect(message.summary).not.toContain('USD 0.00');
  });

  it('uses successful evaluation counts when collection status remains partial', async () => {
    const screen = fixture({ status: 'partial' });
    const generateReport = vi.fn<StockReportAlertGenerator>(async (ticker, options) => ({
      ticker,
      lookbackDays: options.lookbackDays,
      dataAsOf: '2026-10-02',
      decision: 'BUY',
      gateReasons: [],
      historical: null,
      analystTargets: null,
    }));
    const cheap = buildStockScreenWhatsAppNotification(screen);
    const rich = await buildStockScreenReportNotification(screen, { generateReport });
    expect(cheap.title).toBe('종목 스크리닝 · BUY · 평가 완료 1/1');
    expect(rich.title).toBe(cheap.title);
    expect(cheap.title).not.toMatch(/일부 누락|자료 없음/);
    expect(screen.status).toBe('partial');
  });

  it('keeps bounded titles and readable summary lines while sanitizing control characters', () => {
    const matches = [
      candidate(` OII\n\u0000\u202e${'😀'.repeat(100)}`),
      candidate('B'.repeat(32)),
      candidate('C'.repeat(32)),
    ];
    const message = buildStockScreenWhatsAppNotification(
      fixture({
        generatedAt: `2026-10-05\r\n\u202e${'😀'.repeat(100)}`,
        matches,
      })
    );
    expect(message.title.length).toBeLessThanOrEqual(80);
    expect(message.asOf.length).toBeLessThanOrEqual(60);
    expect(message.summary.length).toBeLessThanOrEqual(700);
    for (const value of Object.values(message)) {
      expect(value.replaceAll('\n', '')).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
      expect(value).not.toContain('  ');
      expect(value.isWellFormed()).toBe(true);
    }
    expect(message.summary).toContain(`${'C'.repeat(32)} BUY`);
    expect(message.summary.split('\n')).toHaveLength(3);
  });
});
