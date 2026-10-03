import { mock } from 'bun:test';
import { startStdioServer } from '@mcp/stdio.ts';
import { fixtureReport } from '@mcp/test-fixtures/report.ts';

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
  }
);
