import { describe, expect, test } from 'bun:test';
import { prepareFinvizScreen, registerFinvizScreenTool } from '@mcp/finviz.ts';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';

describe('Finviz candidate preparation', () => {
  test('keeps candidate selection separate from Stock Checker decisions and page coverage', () => {
    const plan = prepareFinvizScreen();
    const url = new URL(plan.url);
    expect(url.origin).toBe('https://finviz.com');
    expect(url.pathname).toBe('/screener');
    expect(url.searchParams.get('v')).toBe('411');
    expect(url.searchParams.get('f')).toBe('ind_stocksonly,ta_sma50_pb');
    expect(plan.decision).toBe('BUY');
    expect(plan.criteria).toEqual({
      priceBelowSma50: true,
      marketCapUsd: null,
      averageVolumeShares: null,
      priceUsd: null,
    });
    expect(plan.collection.join(' ')).toContain('mark the manifest partial');
    expect(plan.collection.join(' ')).toContain('displayed filtered Total');
    expect(plan.warnings.join(' ')).toContain('engine final decision determines');
    expect(plan).not.toHaveProperty('sourceTotal');
    expect(plan).not.toHaveProperty('tickers');
  });

  test('can retain all Finviz stocks while disabling the candidate thresholds', () => {
    const plan = prepareFinvizScreen({ belowSma50: false });
    expect(plan.filters).toEqual(['ind_stocksonly']);
    expect(plan.criteria).toEqual({
      priceBelowSma50: false,
      marketCapUsd: null,
      averageVolumeShares: null,
      priceUsd: null,
    });
  });

  test.each(['SELL', 'HOLD', 'ALL'])(
    'does not apply the BUY pullback prefilter to %s',
    (decision) => {
      const plan = prepareFinvizScreen({ decision });
      expect(plan.filters).toEqual(['ind_stocksonly']);
      expect(plan.criteria.priceBelowSma50).toBe(false);
    }
  );

  test('keeps optional speed limits separate from mandatory SC quality checks', () => {
    const plan = prepareFinvizScreen({
      marketCap: 'over2b',
      averageVolume: 'over500k',
      price: 'over5',
    });
    expect(plan.filters).toEqual([
      'cap_midover',
      'ind_stocksonly',
      'sh_avgvol_o500',
      'sh_price_o5',
      'ta_sma50_pb',
    ]);
    expect(plan.warnings.join(' ')).toContain('not mandatory SC BUY rules');
    expect(plan.warnings.join(' ')).toContain('intraday quote');
    expect(plan.secondPass.join(' ')).toContain('market/sector relative strength');
  });

  test('discovers and validates the preparation tool through JSON-RPC without external access', async () => {
    const server = new McpServer({ name: 'finviz-test', version: '1' });
    registerFinvizScreenTool(server);
    const client = new Client({ name: 'finviz-test', version: '1' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        name: 'prepare_finviz_screen',
        annotations: { readOnlyHint: true, openWorldHint: false },
      });
      const prepared = await client.callTool({ name: 'prepare_finviz_screen', arguments: {} });
      expect(prepared.structuredContent).toMatchObject({ plan: { source: 'Finviz' } });
      const rejected = await client.callTool({
        name: 'prepare_finviz_screen',
        arguments: { url: 'https://elsewhere.invalid/?key=secret' },
      });
      expect(rejected.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
