import { describe, expect, mock, test } from 'bun:test';
import {
  createStockAnalystServer,
  type DashboardLauncher,
  type ReportGenerator,
  SERVER_INSTRUCTIONS,
} from '@mcp/server.ts';
import { fixtureReport, fixtureValuation } from '@mcp/test-fixtures/report.ts';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';

async function withClient(
  generator: ReportGenerator,
  check: (client: Client) => Promise<void>,
  dashboardLauncher?: DashboardLauncher
): Promise<void> {
  const server = createStockAnalystServer(generator, dashboardLauncher);
  const client = new Client({ name: 'stock-checker-test', version: '1.0.0' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await check(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe('analyze_stock MCP tool', () => {
  test('returns markdown and structured financial data without converting unknown rates to zero', async () => {
    const report = fixtureReport('AAPL');
    await withClient(
      async () => ({ report, markdown: '# AAPL fixture report' }),
      async (client) => {
        const result = await client.callTool({
          name: 'analyze_stock',
          arguments: { ticker: 'AAPL' },
        });
        expect(result).toMatchObject({
          isError: false,
          content: [{ type: 'text', text: '# AAPL fixture report' }],
          structuredContent: { report },
        });
        expect(result).toMatchObject({
          structuredContent: {
            report: {
              historical: { fixedHold: { samples: 0, winRatePct: null } },
              valuation: null,
            },
          },
        });
      }
    );
  });

  test('marks missing analysis as an error while preserving its unavailable report', async () => {
    const report = fixtureReport('EMPTY', 'unavailable');
    await withClient(
      async () => ({ report, markdown: '# Analysis unavailable' }),
      async (client) => {
        const result = await client.callTool({
          name: 'analyze_stock',
          arguments: { ticker: 'EMPTY' },
        });
        expect(result).toMatchObject({
          isError: true,
          content: [{ type: 'text', text: '# Analysis unavailable' }],
          structuredContent: { report },
        });
      }
    );
  });

  test('preserves valuation metrics, peer samples, and provenance through the MCP transport', async () => {
    const report = fixtureReport('OII');
    report.valuation = fixtureValuation('OII');
    await withClient(
      async () => ({ report, markdown: '# OII valuation fixture' }),
      async (client) => {
        const result = await client.callTool({
          name: 'analyze_stock',
          arguments: { ticker: 'OII' },
        });
        expect(result).toMatchObject({
          isError: false,
          structuredContent: {
            report: {
              current: { decision: 'HOLD' },
              valuation: report.valuation,
            },
          },
        });
      }
    );
  });

  test('discovers the read-only tool and bounded input schema through the SDK', async () => {
    await withClient(
      async () => {
        throw new Error('Report generator must not run during discovery');
      },
      async (client) => {
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(3);
        expect(tools[0]).toMatchObject({
          name: 'analyze_stock',
          annotations: { readOnlyHint: true, destructiveHint: false },
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['ticker'],
            properties: {
              ticker: { type: 'string', maxLength: 32 },
              lookbackDays: { type: 'integer', minimum: 730, maximum: 3650, default: 2920 },
            },
          },
        });
        expect(SERVER_INSTRUCTIONS.slice(0, 512)).toContain('not success probabilities');
        expect(SERVER_INSTRUCTIONS.slice(0, 512)).toContain('may be unavailable');
        expect(tools[0]?.description).toContain('trailing PER/PSR');
        expect(tools[0]?.description).toContain('peer median PER/PSR with sample counts');
        expect(tools[1]).toMatchObject({
          name: 'open_stock_dashboard',
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['ticker'],
            properties: { ticker: { type: 'string', maxLength: 32 } },
          },
        });
      }
    );
  });

  test('normalizes a symbol, applies the default, and sanitizes provider errors', async () => {
    const generator = mock(async () => {
      throw new Error('https://market.example/data?token=fixture-secret');
    });
    await withClient(generator, async (client) => {
      const result = await client.callTool({
        name: 'analyze_stock',
        arguments: { ticker: ' aapl ' },
      });
      expect(generator).toHaveBeenCalledWith('AAPL', { lookbackDays: 2920 });
      expect(result).toMatchObject({ isError: true });
      expect(JSON.stringify(result)).toContain('no analysis was produced');
      expect(JSON.stringify(result)).not.toContain('fixture-secret');
      expect(JSON.stringify(result)).not.toContain('https://');
    });
  });

  test.each([
    { ticker: '' },
    { ticker: 'https://example.com/price' },
    { ticker: '../AAPL' },
    { ticker: 'AAPL,MSFT' },
    { ticker: 'AAPL\u0000' },
    { ticker: 'A'.repeat(33) },
    { ticker: 'AAPL', lookbackDays: 729 },
    { ticker: 'AAPL', lookbackDays: 3651 },
    { ticker: 'AAPL', lookbackDays: 730.5 },
    { ticker: 'AAPL', lookbackDays: '730' },
    { ticker: 'AAPL', requestUrl: 'https://example.com' },
  ])('rejects invalid input before fetching data: %j', async (arguments_) => {
    const generator = mock(async () => {
      throw new Error('Invalid arguments must not reach the report service');
    });
    await withClient(generator, async (client) => {
      const result = await client.callTool({ name: 'analyze_stock', arguments: arguments_ });
      expect(result).toMatchObject({ isError: true });
      expect(generator).not.toHaveBeenCalled();
    });
  });

  test.each(['brk-b', 'BTC-USD', '005930.KS', '^GSPC', 'CL=F'])(
    'accepts market symbol %s',
    async (ticker) => {
      const generator = mock(async () => {
        throw new Error('Fixture');
      });
      await withClient(generator, async (client) => {
        await client.callTool({ name: 'analyze_stock', arguments: { ticker, lookbackDays: 730 } });
        expect(generator).toHaveBeenCalledWith(ticker.toUpperCase(), { lookbackDays: 730 });
      });
    }
  );
});

describe('open_stock_dashboard MCP tool', () => {
  test('opens only on explicit dashboard calls and returns its normalized link', async () => {
    const generator = mock(async () => ({
      report: fixtureReport('AAPL'),
      markdown: '# AAPL fixture report',
    }));
    const dashboardLauncher = mock(async (ticker: string) => ({
      ticker,
      url: `http://localhost:5100/${ticker}`,
      opened: true,
      readiness: 'listening' as const,
      status: 'opened' as const,
      message: 'Browser launch requested.',
    }));
    await withClient(
      generator,
      async (client) => {
        await client.callTool({ name: 'analyze_stock', arguments: { ticker: 'AAPL' } });
        expect(dashboardLauncher).not.toHaveBeenCalled();
        const result = await client.callTool({
          name: 'open_stock_dashboard',
          arguments: { ticker: ' brk-b ' },
        });
        expect(dashboardLauncher).toHaveBeenCalledWith('BRK-B');
        expect(generator).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
          isError: false,
          content: [{ type: 'text', text: expect.stringContaining('http://localhost:5100/BRK-B') }],
          structuredContent: {
            ticker: 'BRK-B',
            url: 'http://localhost:5100/BRK-B',
            opened: true,
            readiness: 'listening',
            status: 'opened',
          },
        });
      },
      dashboardLauncher
    );
  });

  test('preserves a stopped-server link and startup instructions', async () => {
    await withClient(
      async () => {
        throw new Error('Dashboard calls must not generate a report');
      },
      async (client) => {
        const result = await client.callTool({
          name: 'open_stock_dashboard',
          arguments: { ticker: 'OII' },
        });
        expect(result).toMatchObject({
          isError: true,
          structuredContent: {
            ticker: 'OII',
            url: 'http://localhost:5100/OII',
            opened: false,
            readiness: 'unavailable',
            status: 'not_running',
          },
        });
        expect(JSON.stringify(result)).toContain('mise run dev');
      },
      async (ticker) => ({
        ticker,
        url: 'http://localhost:5100/OII',
        opened: false,
        readiness: 'unavailable',
        status: 'not_running',
        message: 'Run `mise run dev`, then try again.',
      })
    );
  });

  test('sanitizes unexpected dashboard launcher errors', async () => {
    await withClient(
      async () => {
        throw new Error('Dashboard calls must not generate a report');
      },
      async (client) => {
        const result = await client.callTool({
          name: 'open_stock_dashboard',
          arguments: { ticker: 'OII' },
        });
        expect(result).toMatchObject({ isError: true });
        expect(JSON.stringify(result)).not.toContain('fixture-secret');
      },
      async () => {
        throw new Error('https://dashboard.example?key=fixture-secret');
      }
    );
  });

  test.each([
    { ticker: '' },
    { ticker: '../AAPL' },
    { ticker: 'AAPL;open' },
    { ticker: 'AAPL\u0000' },
    { ticker: 'A'.repeat(33) },
    { ticker: 'AAPL', url: 'https://example.com' },
    { ticker: 'AAPL', lookbackDays: 730 },
  ])('rejects invalid dashboard inputs before browser launch: %j', async (arguments_) => {
    const dashboardLauncher = mock(async () => {
      throw new Error('Invalid arguments must not reach the dashboard launcher');
    });
    await withClient(
      async () => {
        throw new Error('Dashboard calls must not generate a report');
      },
      async (client) => {
        const result = await client.callTool({
          name: 'open_stock_dashboard',
          arguments: arguments_,
        });
        expect(result).toMatchObject({ isError: true });
        expect(dashboardLauncher).not.toHaveBeenCalled();
      },
      dashboardLauncher
    );
  });
});
