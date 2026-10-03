import { McpServer } from '@modelcontextprotocol/server';
import type { generateStockAnalystReport } from '@stock-checker/core/src/reports/stock-analyst.ts';
import { z } from 'zod/v4';

export type ReportGenerator = typeof generateStockAnalystReport;

export const SERVER_INSTRUCTIONS =
  'Analyze one ticker using completed market sessions. Buy/sell scores and score weights describe signals, not success probabilities. Historical rates describe observed backtest outcomes with sample counts and execution assumptions; they do not predict future returns. Optional fundamentals, earnings, analyst targets, and market sources may be unavailable. Read report warnings and availability before drawing conclusions. Reports provide analysis, not orders or guaranteed investment advice.';

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

async function generateReport(...args: Parameters<ReportGenerator>): ReturnType<ReportGenerator> {
  const core = await import('@stock-checker/core/src/reports/stock-analyst.ts');
  return core.generateStockAnalystReport(...args);
}

export function createStockAnalystServer(generator: ReportGenerator = generateReport): McpServer {
  const server = new McpServer(
    { name: 'stock-checker', version: '0.0.0' },
    { instructions: SERVER_INSTRUCTIONS }
  );

  server.registerTool(
    'analyze_stock',
    {
      title: 'Analyze a stock',
      description:
        'Create a stock report with current signals, conditional execution levels, observed historical outcomes, and source availability. Scores are not win probabilities. This tool reads market data and does not place orders.',
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

  return server;
}
