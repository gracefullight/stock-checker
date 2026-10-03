import { buildDashboardUrl, openStockDashboard, renderDashboardResult } from '@mcp/dashboard.ts';
import type { generateStockDashboard } from '@mcp/dashboard-data.ts';
import {
  DASHBOARD_MIME_TYPE,
  DASHBOARD_RESOURCE_META,
  DASHBOARD_RESOURCE_URI,
  dashboardHtml,
} from '@mcp/dashboard-ui.ts';
import { McpServer } from '@modelcontextprotocol/server';
import type { generateStockAnalystReport } from '@stock-checker/core/src/reports/stock-analyst.ts';
import { z } from 'zod/v4';

export type ReportGenerator = typeof generateStockAnalystReport;
export type DashboardLauncher = typeof openStockDashboard;
export type DashboardGenerator = typeof generateStockDashboard;

export const SERVER_INSTRUCTIONS =
  'Analyze one ticker using completed market sessions. Buy/sell scores and score weights describe signals, not success probabilities. Historical rates describe observed backtest outcomes with sample counts and execution assumptions; they do not predict future returns. Optional fundamentals, earnings, analyst targets, valuation, and market sources may be unavailable. Valuation reports trailing PER and PSR, with forward PER shown separately. Industry comparisons use a bounded sample of Yahoo peers in the same industry, with separate sample counts for each median; they do not represent the entire industry. A lower multiple alone does not imply BUY. Read report warnings and availability before drawing conclusions. Reports provide analysis, not orders or guaranteed investment advice. When the user asks for a dashboard in chat, use show_stock_dashboard. MCP Apps clients can render its interactive chart and report without a separate web server; other clients receive a text report and dashboard link. Use open_stock_dashboard only when the user asks to launch a browser. It checks the web listener and does not start servers. analyze_stock and show_stock_dashboard never launch a browser.';

export const analyzeStockInput = z.strictObject({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^\^?[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*(?:=[A-Za-z0-9]+)?$/)
    .describe('One market symbol, such as AAPL, BRK-B, 005930.KS, or ^GSPC.'),
  lookbackDays: z
    .number()
    .int()
    .min(730)
    .max(3650)
    .default(2920)
    .describe('Calendar days of historical data; default 2920, range 730–3650.'),
});

export const openStockDashboardInput = analyzeStockInput.pick({ ticker: true });

async function generateReport(...args: Parameters<ReportGenerator>): ReturnType<ReportGenerator> {
  const core = await import('@stock-checker/core/src/reports/stock-analyst.ts');
  return core.generateStockAnalystReport(...args);
}

async function generateDashboard(
  ...args: Parameters<DashboardGenerator>
): ReturnType<DashboardGenerator> {
  const dashboard = await import('@mcp/dashboard-data.ts');
  return dashboard.generateStockDashboard(...args);
}

export function createStockAnalystServer(
  generator: ReportGenerator = generateReport,
  dashboardLauncher: DashboardLauncher = openStockDashboard,
  dashboardGenerator: DashboardGenerator = generateDashboard
): McpServer {
  const server = new McpServer(
    { name: 'stock-checker', version: '0.0.0' },
    { instructions: SERVER_INSTRUCTIONS }
  );

  server.registerResource(
    'stock-dashboard',
    DASHBOARD_RESOURCE_URI,
    {
      title: 'Stock analyst dashboard',
      description: 'Interactive completed-session price chart and stock analyst report.',
      mimeType: DASHBOARD_MIME_TYPE,
      _meta: DASHBOARD_RESOURCE_META,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: DASHBOARD_MIME_TYPE,
          text: dashboardHtml,
          _meta: DASHBOARD_RESOURCE_META,
        },
      ],
    })
  );

  server.registerTool(
    'analyze_stock',
    {
      title: 'Analyze a stock',
      description:
        'Create a stock report with current signals, conditional execution levels, observed historical outcomes, analyst targets, and valuation. Includes trailing PER/PSR, separate forward PER, and same-industry Yahoo peer median PER/PSR with sample counts when available. Scores are not win probabilities. This tool reads market data and does not place orders.',
      inputSchema: analyzeStockInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ticker, lookbackDays }) => {
      const symbol = ticker.toUpperCase();
      try {
        const { report, markdown } = await generator(symbol, { lookbackDays });
        return {
          content: [{ type: 'text', text: markdown }],
          structuredContent: { report },
          isError: report.status === 'unavailable',
        };
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: `Unable to generate a report for ${symbol}. Market data or the report service could not be accessed; no analysis was produced.`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'open_stock_dashboard',
    {
      title: 'Open a stock dashboard',
      description:
        'Open the existing ticker detail dashboard in the local default browser and return its link. Uses STOCK_CHECKER_DASHBOARD_URL or http://localhost:5100. Checks the web listener only; if unavailable, returns the link with instructions to run mise run dev. Does not start servers or place orders.',
      inputSchema: openStockDashboardInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ticker }) => {
      try {
        const result = await dashboardLauncher(ticker.toUpperCase());
        return {
          content: [{ type: 'text', text: renderDashboardResult(result) }],
          structuredContent: { ...result },
          isError: !result.opened,
        };
      } catch {
        return {
          content: [{ type: 'text', text: 'The dashboard could not be opened. Try again later.' }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'show_stock_dashboard',
    {
      title: 'Show a stock dashboard in chat',
      description:
        'Display an interactive MCP Apps dashboard with completed daily candles, volume, current signal, conditional execution, historical sample rates, TTM PER/PSR peer comparisons, and analyst targets. Works without the Next.js/API servers. Clients without MCP Apps receive the text report and optional web link. Never launches a browser or places orders.',
      inputSchema: analyzeStockInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: { ui: { resourceUri: DASHBOARD_RESOURCE_URI } },
    },
    async ({ ticker, lookbackDays }) => {
      const symbol = ticker.toUpperCase();
      try {
        const { report, chart, markdown } = await dashboardGenerator(symbol, { lookbackDays });
        let dashboardUrl: string | null = null;
        try {
          dashboardUrl = buildDashboardUrl(symbol).toString();
        } catch {
          // Optional browser configuration must not prevent the self-contained app.
        }
        return {
          content: [
            {
              type: 'text',
              text: `${markdown}\n\nInteractive dashboard: available in MCP Apps clients.${dashboardUrl ? ` Browser detail link (requires the web/API servers): [${symbol} dashboard](${dashboardUrl}).` : ''}`,
            },
          ],
          structuredContent: { report, chart, dashboardUrl },
          isError: report.status === 'unavailable' && chart.status === 'unavailable',
        };
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: `Unable to prepare the dashboard for ${symbol}. Market data is unavailable; no dashboard data was produced.`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}
