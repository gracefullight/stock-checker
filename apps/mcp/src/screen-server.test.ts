import { describe, expect, mock, test } from 'bun:test';
import {
  createStockAnalystServer,
  type ScreenGenerator,
  SERVER_INSTRUCTIONS,
} from '@mcp/server.ts';
import { fixtureScreen, fixtureScreenMatch } from '@mcp/test-fixtures/screen.ts';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';

async function withScreenClient(
  generator: ScreenGenerator,
  check: (client: Client) => Promise<void>
): Promise<void> {
  const server = createStockAnalystServer(undefined, undefined, undefined, generator);
  const client = new Client({ name: 'stock-screen-test', version: '1.0.0' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await check(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe('screen_stocks MCP tool', () => {
  test('preserves BUY candidates, gate reasons, conditional execution and coverage', async () => {
    const screen = fixtureScreen();
    await withScreenClient(
      async () => ({ screen, markdown: '# BUY candidates fixture' }),
      async (client) => {
        const result = await client.callTool({
          name: 'screen_stocks',
          arguments: { tickers: ['AAPL'] },
        });
        expect(result).toMatchObject({
          isError: false,
          content: [{ type: 'text', text: '# BUY candidates fixture' }],
          structuredContent: { screen },
        });
        expect(result).toMatchObject({
          structuredContent: {
            screen: {
              matches: [
                {
                  decision: 'BUY',
                  gates: { trend: { passed: true }, institutional: { passed: true } },
                  execution: { entry: { eligible: true, price: null } },
                },
              ],
              criteria: { timeBudgetMs: 45000 },
            },
          },
        });
      }
    );
  });

  test('treats an analyzed high-score HOLD with failed gates as a normal empty BUY screen', async () => {
    const hold = fixtureScreenMatch('AAPL', 'HOLD');
    const screen = fixtureScreen({
      matches: [],
      excluded: [
        {
          ticker: hold.ticker,
          decision: hold.decision,
          score: hold.score,
          buyScore: hold.buyScore,
          sellScore: hold.sellScore,
          gateReasons: hold.gateReasons,
        },
      ],
      coverage: {
        requested: 1,
        analyzed: 1,
        unavailable: 0,
        matched: 0,
        returned: 0,
        truncated: false,
      },
      decisionCounts: { BUY: 0, SELL: 0, HOLD: 1 },
    });
    await withScreenClient(
      async () => ({ screen, markdown: 'No analyzed ticker has final decision BUY.' }),
      async (client) => {
        const result = await client.callTool({
          name: 'screen_stocks',
          arguments: { tickers: ['AAPL'] },
        });
        expect(result).toMatchObject({ isError: false, structuredContent: { screen } });
        expect(result).toMatchObject({
          structuredContent: {
            screen: { matches: [], excluded: [{ decision: 'HOLD', buyScore: 500 }] },
          },
        });
      }
    );
  });

  test('returns partial coverage without discarding successful candidates', async () => {
    const screen = fixtureScreen({
      status: 'partial',
      universe: { source: 'provided', tickers: ['AAPL', 'BAD'] },
      coverage: {
        requested: 2,
        analyzed: 1,
        unavailable: 1,
        matched: 1,
        returned: 1,
        truncated: false,
      },
      unavailable: [
        { ticker: 'BAD', reason: 'No usable completed-session analysis is available.' },
      ],
    });
    await withScreenClient(
      async () => ({ screen, markdown: '# Partial screen fixture' }),
      async (client) => {
        expect(
          await client.callTool({ name: 'screen_stocks', arguments: { tickers: ['AAPL', 'BAD'] } })
        ).toMatchObject({ isError: false, structuredContent: { screen } });
      }
    );
  });

  test('marks an entirely unavailable screen as an error while retaining availability evidence', async () => {
    const screen = fixtureScreen({
      status: 'unavailable',
      universe: { source: 'provided', tickers: ['BAD'] },
      coverage: {
        requested: 1,
        analyzed: 0,
        unavailable: 1,
        matched: 0,
        returned: 0,
        truncated: false,
      },
      decisionCounts: { BUY: 0, SELL: 0, HOLD: 0 },
      matches: [],
      unavailable: [{ ticker: 'BAD', reason: 'Analysis could not be completed for this ticker.' }],
    });
    await withScreenClient(
      async () => ({ screen, markdown: 'No ticker could be analyzed.' }),
      async (client) => {
        expect(
          await client.callTool({ name: 'screen_stocks', arguments: { tickers: ['BAD'] } })
        ).toMatchObject({ isError: true, structuredContent: { screen } });
      }
    );
  });

  test('discovers a bounded, read-only core-decision screen with BUY defaults', async () => {
    const generator = mock(async () => {
      throw new Error('Discovery must not analyze tickers');
    });
    await withScreenClient(generator, async (client) => {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(4);
      const tool = tools.find((item) => item.name === 'screen_stocks');
      expect(tool).toMatchObject({
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tickers: {
              type: 'array',
              minItems: 1,
              maxItems: 50,
              items: { type: 'string', minLength: 1, maxLength: 32 },
            },
            decision: { enum: ['BUY', 'SELL', 'HOLD', 'ALL'], default: 'BUY' },
            lookbackDays: { type: 'integer', minimum: 730, maximum: 3650, default: 730 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        },
      });
      expect(tool?.description).toContain('after quality gates');
      expect(tool?.description).toContain('20-symbol universe');
      expect(tool?.description).toContain('scores are not win probabilities');
      expect(SERVER_INSTRUCTIONS).toContain('does not search the entire market');
      expect(generator).not.toHaveBeenCalled();
    });
  });

  test('applies optional defaults and sanitizes provider errors', async () => {
    const generator = mock(async () => {
      throw new Error('https://market.example/screen?token=fixture-secret');
    });
    await withScreenClient(generator, async (client) => {
      const result = await client.callTool({ name: 'screen_stocks', arguments: {} });
      expect(generator).toHaveBeenCalledWith({
        tickers: undefined,
        decision: 'BUY',
        lookbackDays: 730,
        limit: 20,
      });
      expect(result).toMatchObject({ isError: true });
      expect(JSON.stringify(result)).toContain('no screening result was produced');
      expect(JSON.stringify(result)).not.toContain('fixture-secret');
      expect(JSON.stringify(result)).not.toContain('https://');
    });
  });

  test('normalizes supplied symbols while leaving deduplication to the core generator', async () => {
    const generator = mock(async () => {
      throw new Error('Fixture');
    });
    await withScreenClient(generator, async (client) => {
      await client.callTool({
        name: 'screen_stocks',
        arguments: {
          tickers: [' oii ', 'OII', '^gspc', 'brk-b', '005930.ks', 'cl=f'],
          decision: 'ALL',
          lookbackDays: 2920,
          limit: 50,
        },
      });
      expect(generator).toHaveBeenCalledWith({
        tickers: ['OII', 'OII', '^GSPC', 'BRK-B', '005930.KS', 'CL=F'],
        decision: 'ALL',
        lookbackDays: 2920,
        limit: 50,
      });
    });
  });

  test.each([
    { tickers: [] },
    { tickers: Array.from({ length: 51 }, () => 'AAPL') },
    { tickers: 'AAPL,MSFT' },
    { tickers: ['AAPL,MSFT'] },
    { tickers: ['../AAPL'] },
    { tickers: ['AAPL;open'] },
    { tickers: ['AAPL\u0000'] },
    { tickers: [''] },
    { tickers: ['A'.repeat(33)] },
    { tickers: [123] },
    { decision: 'buy' },
    { decision: 'ANY' },
    { decision: null },
    { lookbackDays: 729 },
    { lookbackDays: 3651 },
    { lookbackDays: 730.5 },
    { lookbackDays: '730' },
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { limit: '20' },
    { requestUrl: 'https://example.com' },
  ])('rejects invalid screen input before market-data work: %j', async (arguments_) => {
    const generator = mock(async () => {
      throw new Error('Invalid input must not reach the screen generator');
    });
    await withScreenClient(generator, async (client) => {
      expect(await client.callTool({ name: 'screen_stocks', arguments: arguments_ })).toMatchObject(
        {
          isError: true,
        }
      );
      expect(generator).not.toHaveBeenCalled();
    });
  });
});
