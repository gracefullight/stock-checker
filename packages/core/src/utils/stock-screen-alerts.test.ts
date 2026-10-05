import { describe, expect, it } from 'vitest';
import type { StockScreenMatch, StockScreenResult } from '@/reports/stock-screen';
import { buildStockScreenWhatsAppNotification } from '@/utils/stock-screen-alerts';

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
  it('distinguishes scan completion from per-ticker completed bars and reference prices', () => {
    const first = candidate('AAPL');
    const second = candidate('OII', { dataAsOf: '2026-10-01' });
    const screen = fixture({ matches: [first, second] });
    const original = structuredClone(screen);
    const message = buildStockScreenWhatsAppNotification(screen);

    expect(message.title).toBe('Stock Checker screen: BUY available');
    expect(message.asOf).toBe('Scan completed 2026-10-05T03:30:00.000Z');
    expect(message.summary).toContain('AAPL BUY bar 2026-10-02 reference 123.46');
    expect(message.summary).toContain('OII BUY bar 2026-10-01 reference 123.46');
    expect(message.summary).toContain('completed-close references are not fills');
    expect(message.summary).toContain('bar dates vary by ticker');
    expect(message.summary).toContain('Scores are not probabilities of profit');
    expect(message.summary).not.toContain('300');
    expect(screen).toEqual(original);
  });

  it('limits alerts to three returned candidates and states report truncation independently', () => {
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
    const { summary } = buildStockScreenWhatsAppNotification(screen);

    expect(summary).toContain(
      'Status partial; filter BUY; analyzed 19/20; matched 8; unavailable 1'
    );
    expect(summary).toContain(
      'Report returned 5/8 matches, limit 5, truncated; alert shows 3/5 returned'
    );
    expect(summary).toContain('AAPL BUY');
    expect(summary).toContain('MSFT BUY');
    expect(summary).toContain('NVDA BUY');
    expect(summary).not.toMatch(/OII|SPCX/);
    expect(summary.length).toBeLessThanOrEqual(700);
  });

  it.each(['available', 'unavailable'] as const)(
    'retains %s status and missing-data counts when no candidates were returned',
    (status) => {
      const unavailable = status === 'unavailable' ? 2 : 0;
      const { summary } = buildStockScreenWhatsAppNotification(
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
      expect(summary).toContain(`Status ${status}`);
      expect(summary).toContain(
        `analyzed ${2 - unavailable}/2; matched 0; unavailable ${unavailable}`
      );
      expect(summary).toContain('Report returned 0/0 matches');
      expect(summary).toContain('alert shows 0/0 returned');
      expect(summary).toContain('Candidates: none.');
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
    expect(message.title).toBe('Stock Checker screen: ALL available');
    expect(message.summary).toContain('filter ALL');
    expect(message.summary).toContain('OII HOLD bar n/a reference n/a');
    expect(message.summary).not.toContain('USD 0.00');
  });

  it('produces bounded well-formed single-line template variables even with control characters', () => {
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
      expect(value).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
      expect(value).not.toContain('  ');
      expect(value.isWellFormed()).toBe(true);
    }
    expect(message.summary).toContain(`${'C'.repeat(32)} BUY`);
  });
});
