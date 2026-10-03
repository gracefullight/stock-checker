import { describe, expect, mock, test } from 'bun:test';
import type { StockDashboardData } from '@mcp/dashboard-data.ts';
import { DASHBOARD_MIME_TYPE, DASHBOARD_RESOURCE_URI } from '@mcp/dashboard-ui.ts';
import { createStockAnalystServer, type DashboardGenerator } from '@mcp/server.ts';
import { fixtureReport, fixtureValuation } from '@mcp/test-fixtures/report.ts';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';

function fixture(): StockDashboardData {
  const report = fixtureReport('SPCX');
  report.valuation = fixtureValuation('SPCX');
  return {
    report,
    chart: {
      ticker: 'SPCX',
      status: 'available',
      source: 'Offline fixture',
      reason: null,
      candles: [{ date: '2026-10-02', open: 158, high: 160, low: 156, close: 159, volume: 1000 }],
    },
    markdown: '# SPCX analyst report',
  };
}

async function withDashboard(
  generator: DashboardGenerator,
  check: (client: Client) => Promise<void>
): Promise<void> {
  const opener = mock(async () => {
    throw new Error('Unexpected browser launch');
  });
  const server = createStockAnalystServer(
    async () => {
      throw new Error('Unexpected analysis tool call');
    },
    opener,
    generator
  );
  const client = new Client({ name: 'dashboard-transport-test', version: '1.0.0' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await check(client);
    expect(opener).not.toHaveBeenCalled();
  } finally {
    await client.close();
    await server.close();
  }
}

describe('inline stock dashboard MCP transport', () => {
  test('advertises the app resource and a read-only dashboard tool', async () => {
    await withDashboard(
      async () => fixture(),
      async (client) => {
        const { tools } = await client.listTools();
        expect(tools.find((tool) => tool.name === 'show_stock_dashboard')).toMatchObject({
          annotations: { readOnlyHint: true, destructiveHint: false },
          _meta: { ui: { resourceUri: DASHBOARD_RESOURCE_URI } },
        });
        const { resources } = await client.listResources();
        expect(resources).toMatchObject([
          { uri: DASHBOARD_RESOURCE_URI, mimeType: DASHBOARD_MIME_TYPE },
        ]);
        const { contents } = await client.readResource({ uri: DASHBOARD_RESOURCE_URI });
        expect(contents[0]).toMatchObject({
          uri: DASHBOARD_RESOURCE_URI,
          mimeType: DASHBOARD_MIME_TYPE,
          text: expect.stringContaining('ui/initialize'),
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
        });
      }
    );
  });

  test('returns chart and valuation unchanged with meaningful text for a client without UI', async () => {
    const data = fixture();
    const generator = mock(async () => data);
    await withDashboard(generator, async (client) => {
      const result = await client.callTool({
        name: 'show_stock_dashboard',
        arguments: { ticker: ' spcx ' },
      });
      expect(generator).toHaveBeenCalledWith('SPCX', { lookbackDays: 2920 });
      expect(result).toMatchObject({
        isError: false,
        structuredContent: { report: data.report, chart: data.chart },
        content: [{ type: 'text', text: expect.stringContaining('# SPCX analyst report') }],
      });
    });
  });

  test('keeps the report available when chart data is missing', async () => {
    const data = fixture();
    data.chart = {
      ...data.chart,
      candles: [],
      status: 'unavailable',
      reason: 'No completed candles',
    };
    await withDashboard(
      async () => data,
      async (client) => {
        expect(
          await client.callTool({ name: 'show_stock_dashboard', arguments: { ticker: 'SPCX' } })
        ).toMatchObject({
          isError: false,
          structuredContent: { chart: { status: 'unavailable' } },
        });
      }
    );
  });

  test('returns chart data when the technical report is unavailable', async () => {
    const data = fixture();
    data.report = fixtureReport('SPCX', 'unavailable');
    await withDashboard(
      async () => data,
      async (client) => {
        expect(
          await client.callTool({ name: 'show_stock_dashboard', arguments: { ticker: 'SPCX' } })
        ).toMatchObject({
          isError: false,
          structuredContent: { report: { status: 'unavailable' }, chart: { status: 'available' } },
        });
      }
    );
  });

  test('marks unavailable report and chart as an error while retaining their data', async () => {
    const data = fixture();
    data.report = fixtureReport('SPCX', 'unavailable');
    data.chart = { ...data.chart, status: 'unavailable', candles: [], reason: 'Unavailable' };
    await withDashboard(
      async () => data,
      async (client) => {
        expect(
          await client.callTool({ name: 'show_stock_dashboard', arguments: { ticker: 'SPCX' } })
        ).toMatchObject({
          isError: true,
          structuredContent: { report: { ticker: 'SPCX' } },
        });
      }
    );
  });

  test('sanitizes provider failures', async () => {
    await withDashboard(
      async () => {
        throw new Error('https://provider.invalid?key=fixture-secret');
      },
      async (client) => {
        const result = await client.callTool({
          name: 'show_stock_dashboard',
          arguments: { ticker: 'SPCX' },
        });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).not.toContain('fixture-secret');
        expect(JSON.stringify(result)).not.toContain('provider.invalid');
      }
    );
  });

  test.each([
    { ticker: '../../file' },
    { ticker: 'SPCX,TSLA' },
    { ticker: 'SPCX', lookbackDays: 729 },
    { ticker: 'SPCX', url: 'https://example.com' },
  ])('rejects invalid arguments before requesting data: %j', async (arguments_) => {
    const generator = mock(async () => fixture());
    await withDashboard(generator, async (client) => {
      expect(
        await client.callTool({ name: 'show_stock_dashboard', arguments: arguments_ })
      ).toMatchObject({ isError: true });
      expect(generator).not.toHaveBeenCalled();
    });
  });
});
