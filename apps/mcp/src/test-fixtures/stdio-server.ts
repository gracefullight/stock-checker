import { mock } from 'bun:test';
import { startStdioServer } from '@mcp/stdio.ts';
import { fixturePerformance } from '@mcp/test-fixtures/performance.ts';
import { fixtureReport } from '@mcp/test-fixtures/report.ts';
import { fixtureScreen, fixtureScreenMatch } from '@mcp/test-fixtures/screen.ts';

class FixtureYahooFinance {
  constructor(options: { logger?: { info: (...args: unknown[]) => void } }) {
    options.logger?.info('fixture Yahoo logger on stderr');
  }

  async chart(): Promise<never> {
    throw new Error('fixture provider unavailable');
  }
}

mock.module('yahoo-finance2', () => ({ default: FixtureYahooFinance }));
process.env.TIINGO_API_KEY = '';

await startStdioServer(
  async (ticker, options) => {
    globalThis.console.info('fixture report log on stderr');
    globalThis.console.write('fixture Bun console.write on stderr\n');
    if (process.env.MCP_LOG_STDERR !== '1') throw new Error('Missing stderr configuration');
    if (ticker === 'FAIL') {
      throw new Error('Provider failed: https://market.example/data?token=fixture-secret');
    }
    const { getHistoricalPrices } = await import(
      '@stock-checker/core/src/services/data-fetcher.ts'
    );
    await getHistoricalPrices(ticker, 730);
    const report = fixtureReport(ticker, ticker === 'EMPTY' ? 'unavailable' : 'available');
    report.lookbackDays = options?.lookbackDays ?? 2920;
    return {
      report,
      markdown: `# ${ticker} fixture report\n\nHistorical success rate unavailable.`,
    };
  },
  async (ticker) => ({
    ticker,
    url: `http://localhost:5100/${encodeURIComponent(ticker)}`,
    opened: true,
    readiness: 'listening',
    status: 'opened',
    message: 'Fixture browser launch requested; no browser was opened.',
  }),
  async (ticker, options) => {
    if (ticker === 'FAIL') throw new Error('Dashboard failed: fixture-secret');
    const report = fixtureReport(ticker);
    report.lookbackDays = options?.lookbackDays ?? 2920;
    return {
      report,
      chart: {
        ticker,
        candles: [{ date: '2026-10-02', open: 100, high: 102, low: 99, close: 101, volume: 1000 }],
        status: 'available',
        source: 'Offline fixture',
        reason: null,
      },
      markdown: `# ${ticker} dashboard fixture`,
    };
  },
  async (options) => {
    if (options?.tickers?.includes('FAIL')) {
      throw new Error('Screen failed: https://fixture.example?key=fixture-secret');
    }
    globalThis.console.info('fixture screen log on stderr');
    const tickers = [...new Set(options?.tickers ?? ['AAPL'])];
    const candidates = tickers.map((ticker) => fixtureScreenMatch(ticker));
    const decision = options?.decision ?? 'BUY';
    const filtered = decision === 'BUY' || decision === 'ALL' ? candidates : [];
    const limit = options?.limit ?? 20;
    const matches = filtered.slice(0, limit);
    const screen = fixtureScreen({
      universe: { source: 'provided', tickers },
      matches,
      excluded: filtered.length
        ? []
        : candidates.map(({ ticker, decision, score, buyScore, sellScore, gateReasons }) => ({
            ticker,
            decision,
            score,
            buyScore,
            sellScore,
            gateReasons,
          })),
      decisionCounts: { BUY: candidates.length, SELL: 0, HOLD: 0 },
      coverage: {
        requested: tickers.length,
        analyzed: candidates.length,
        unavailable: 0,
        matched: filtered.length,
        returned: matches.length,
        truncated: filtered.length > matches.length,
      },
    });
    screen.criteria = {
      ...screen.criteria,
      decision,
      lookbackDays: options?.lookbackDays ?? 730,
      limit,
      sort: {
        metric: decision === 'SELL' ? 'sellScore' : 'buyScore',
        order: 'descending',
        tieBreaker: 'ticker-ascending',
      },
    };
    return { screen, markdown: '# Offline screen fixture' };
  },
  {
    async create() {
      throw new Error('Market-screen creation is not used by this offline fixture.');
    },
    async get() {
      throw new Error('Market-screen reads are not used by this offline fixture.');
    },
    async resume() {
      throw new Error('Market-screen resume is not used by this offline fixture.');
    },
    async pause() {
      throw new Error('Market-screen pause is not used by this offline fixture.');
    },
    async getPerformance(jobId, options) {
      globalThis.console.info('fixture saved performance read on stderr');
      const value = fixturePerformance();
      return {
        ...value,
        jobId,
        page: { ...value.page, offset: options?.offset ?? 0, limit: options?.limit ?? 20 },
      };
    },
    async refreshPerformance(jobId, options) {
      globalThis.console.info('fixture performance refresh on stderr');
      const value = fixturePerformance();
      return {
        ...value,
        jobId,
        refresh: {
          status: 'running' as const,
          selected: Math.min(
            options?.limit ?? 20,
            value.summary.pending + value.summary.open + value.summary.unavailable
          ),
          processed: 0,
          reason: null,
        },
      };
    },
  }
);
