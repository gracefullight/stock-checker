import { buildDashboardUrl, openStockDashboard, renderDashboardResult } from '@mcp/dashboard.ts';
import type { generateStockDashboard } from '@mcp/dashboard-data.ts';
import {
  DASHBOARD_MIME_TYPE,
  DASHBOARD_RESOURCE_META,
  DASHBOARD_RESOURCE_URI,
  dashboardHtml,
} from '@mcp/dashboard-ui.ts';
import { registerFinvizScreenTool } from '@mcp/finviz.ts';
import { type MarketScreenService, registerMarketScreenTools } from '@mcp/market-screen.ts';
import { McpServer } from '@modelcontextprotocol/server';
import type { generateStockAnalystReport } from '@stock-checker/core/src/reports/stock-analyst.ts';
import type { generateStockScreen } from '@stock-checker/core/src/reports/stock-screen.ts';
import { z } from 'zod/v4';
import packageMetadata from '../package.json' with { type: 'json' };

export type ReportGenerator = typeof generateStockAnalystReport;
export type DashboardLauncher = typeof openStockDashboard;
export type DashboardGenerator = typeof generateStockDashboard;
export type ScreenGenerator = typeof generateStockScreen;

export const SERVER_INSTRUCTIONS =
  'Analyze one ticker using completed market sessions. Buy/sell scores and score weights describe signals, not success probabilities. Historical rates describe observed backtest outcomes with sample counts and execution assumptions; they do not predict future returns. Optional fundamentals, earnings, analyst targets, valuation, and market sources may be unavailable. Valuation reports trailing PER and PSR, with forward PER shown separately. Industry comparisons use a bounded sample of Yahoo peers in the same industry, with separate sample counts for each median; they do not represent the entire industry. A lower multiple alone does not imply BUY. Read report warnings and availability before drawing conclusions. Reports provide analysis, not orders or guaranteed investment advice. When the user asks for a dashboard in chat, use show_stock_dashboard. MCP Apps clients can render its interactive chart and report without a separate web server; other clients receive a text report and dashboard link. Use open_stock_dashboard only when the user asks to launch a browser. It checks the web listener and does not start servers. analyze_stock and show_stock_dashboard never launch a browser. When the user asks to find BUY candidates across tickers using Stock Checker criteria, use screen_stocks. It filters the core engine final decision after quality gates, defaults to the existing 20-symbol web universe, and does not search the entire market. Distinguish no matching candidates from unavailable or partially missing analyses. When opening a candidate detail report, pass screen.criteria.lookbackDays to analyze_stock or show_stock_dashboard so decisions use the same history window. For market-wide candidate discovery, use prepare_finviz_screen, collect the displayed Finviz candidate symbols with an available browser MCP such as Aside or an authorized CSV export, then call create_market_screen. The stock-checker server does not fetch or crawl Finviz. Preserve the actual filters, capture time, displayed filtered total, and partial collection status; never treat a missing page or security check as complete coverage. Use get_market_screen for progress and paginated final decisions, and control_market_screen to pause or resume. A completed job covers the supplied candidate manifest, not all global stocks, and its per-ticker session dates may differ. Finviz prefilters select candidates; only the core final decision qualifies a BUY. Pass the job lookbackDays to detailed reports. Use get_market_screen_performance to read saved forward paper observations without market-data requests or scan resumption. Use refresh_market_screen_performance only for an explicit bounded refresh of at most 50 recommendations. Performance describes observed paper outcomes over five sessions after recommendations, not actual fills or a calibrated win probability. Keep closed sample counts separate from pending and unavailable observations; an empty closed sample has no percentage.';

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

export const screenStocksInput = z.strictObject({
  tickers: z
    .array(analyzeStockInput.shape.ticker)
    .min(1)
    .max(50)
    .optional()
    .describe(
      'Optional ticker list, 1–50 entries before deduplication; defaults to the web screener’s 20-symbol universe.'
    ),
  decision: z
    .enum(['BUY', 'SELL', 'HOLD', 'ALL'])
    .default('BUY')
    .describe('Filter the final core engine decision after quality gates; default BUY.'),
  lookbackDays: z
    .number()
    .int()
    .min(730)
    .max(3650)
    .default(730)
    .describe('Calendar days of history per ticker; default 730, range 730–3650.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe('Maximum matched rows to return; default 20, range 1–50.'),
});

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

async function generateScreen(...args: Parameters<ScreenGenerator>): ReturnType<ScreenGenerator> {
  const core = await import('@stock-checker/core/src/reports/stock-screen.ts');
  return core.generateStockScreen(...args);
}

export function createStockAnalystServer(
  generator: ReportGenerator = generateReport,
  dashboardLauncher: DashboardLauncher = openStockDashboard,
  dashboardGenerator: DashboardGenerator = generateDashboard,
  screenGenerator: ScreenGenerator = generateScreen,
  marketScreenService?: MarketScreenService
): McpServer {
  const server = new McpServer(
    { name: 'stock-checker', version: packageMetadata.version },
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

  server.registerTool(
    'screen_stocks',
    {
      title: 'Screen stocks using Stock Checker criteria',
      description:
        'Screen up to 50 provided ticker entries using the core Stock Checker final BUY/SELL/HOLD decision after quality gates. Defaults to BUY matches in the web screener’s 20-symbol universe, with 730 calendar days of history and at most two concurrent ticker analyses. Returns matched candidates, coverage, unavailable tickers, and no-match results. This is a bounded universe screen; scores are not win probabilities. For matching detail decisions, pass screen.criteria.lookbackDays to analyze_stock or show_stock_dashboard. Reads market data without placing orders.',
      inputSchema: screenStocksInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ tickers, decision, lookbackDays, limit }) => {
      try {
        const { screen, markdown } = await screenGenerator({
          tickers: tickers?.map((ticker) => ticker.toUpperCase()),
          decision,
          lookbackDays,
          limit,
        });
        return {
          content: [{ type: 'text', text: markdown }],
          structuredContent: { screen },
          isError: screen.status === 'unavailable',
        };
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: 'Unable to screen stocks. Market data or the screening service could not be accessed; no screening result was produced.',
            },
          ],
          isError: true,
        };
      }
    }
  );

  registerFinvizScreenTool(server);
  registerMarketScreenTools(server, marketScreenService);

  return server;
}
