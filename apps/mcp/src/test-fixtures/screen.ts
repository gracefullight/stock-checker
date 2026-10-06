import { fixtureReport } from '@mcp/test-fixtures/report.ts';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@stock-checker/core/src/constants.ts';
import type {
  StockScreenMatch,
  StockScreenResult,
} from '@stock-checker/core/src/reports/stock-screen.ts';

export function fixtureScreenMatch(
  ticker: string,
  decision: StockScreenMatch['decision'] = 'BUY'
): StockScreenMatch {
  const current = fixtureReport(ticker).current;
  if (!current) throw new Error('Missing current fixture');
  const gates = current.gates;
  if (decision === 'BUY') {
    gates.trend = { passed: true, regime: 'uptrend', strength: 1, reason: 'Fixture uptrend' };
    gates.confluence = { passed: true, activeIndicators: 5, totalIndicators: 5, ratio: 1 };
    gates.institutional.passed = true;
    gates.institutional.score = 1;
    gates.institutional.components = {
      rsSpy: 1,
      rsSector: 1,
      vwap: 1,
      breakoutVol: 1,
      liquidity: 1,
      earnings: 1,
    };
  }
  return {
    ticker,
    dataAsOf: '2026-10-02',
    decision,
    score: decision === 'BUY' ? 300 : 500,
    buyScore: decision === 'BUY' ? 300 : 500,
    sellScore: 10,
    gates,
    gateReasons: [decision === 'BUY' ? 'Fixture gates passed' : 'Fixture trend gate blocked entry'],
    execution: {
      entry: {
        status: 'conditional',
        timing: 'next-session-open',
        price: null,
        eligible: decision === 'BUY',
      },
      reference: {
        basis: 'latest-completed-close',
        price: 100,
        atr: 2,
        stopLoss: 97,
        takeProfit: 106,
        trailingStop: 98,
        trailingStart: 101,
      },
    },
    rsi: 55,
    sector: 'Technology',
  };
}

export function fixtureScreen(overrides: Partial<StockScreenResult> = {}): StockScreenResult {
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-03T00:00:00.000Z',
    status: 'available',
    universe: { source: 'provided', tickers: ['AAPL'] },
    criteria: {
      decision: 'BUY',
      lookbackDays: 730,
      limit: 20,
      timeBudgetMs: 45000,
      engine: 'Offline final-decision fixture',
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
    matches: [fixtureScreenMatch('AAPL')],
    excluded: [],
    unavailable: [],
    warnings: ['Fixture scores are not probabilities of profit.'],
    ...overrides,
  };
}
