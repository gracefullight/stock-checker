import { describe, expect, mock, test } from 'bun:test';
import {
  controlMarketScreenInput,
  createMarketScreenInput,
  getMarketScreenInput,
  getMarketScreenPerformanceInput,
  isFinvizScreenSource,
  type MarketScreenService,
  refreshMarketScreenPerformanceInput,
  registerMarketScreenTools,
} from '@mcp/market-screen.ts';
import { fixturePerformance } from '@mcp/test-fixtures/performance.ts';
import { fixtureScreenMatch } from '@mcp/test-fixtures/screen.ts';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';

const JOB_ID = 'bd6128e1-d410-4a61-a90e-dfbd6a86167e';
const SOURCE_URL = 'https://finviz.com/screener?v=411&f=ind_stocksonly,sh_price_o5&r=1';
const FILTERS = ['ind_stocksonly', 'sh_price_o5'];
type Snapshot = Awaited<ReturnType<MarketScreenService['get']>>;

function candidates() {
  return {
    tickers: [' aapl ', 'msft', 'AAPL'],
    provenance: {
      source: 'Finviz' as const,
      url: SOURCE_URL,
      filters: [...FILTERS],
      sourceTotal: 3,
      overallTotal: 11702,
      capturedAt: '2026-10-03T12:00:00.000Z',
      pages: 1,
      completeness: 'partial' as const,
    },
  };
}

function snapshot(): Snapshot {
  return {
    job: {
      schemaVersion: 1,
      id: JOB_ID,
      status: 'partial',
      createdAt: '2026-10-03T12:01:00.000Z',
      updatedAt: '2026-10-03T12:02:00.000Z',
      startedAt: '2026-10-03T12:01:00.000Z',
      finishedAt: '2026-10-03T12:02:00.000Z',
      universe: {
        source: 'finviz-candidates',
        url: SOURCE_URL,
        filters: [...FILTERS],
        sourceTotal: 3,
        overallTotal: 11702,
        collectedCount: 2,
        inputCount: 3,
        capturedAt: '2026-10-03T12:00:00.000Z',
        pages: 1,
        completeness: 'partial',
      },
      criteria: {
        decision: 'BUY',
        lookbackDays: 730,
        engine: 'Offline final-decision fixture',
        concurrency: 2,
        minIntervalMs: 1000,
      },
      progress: {
        total: 2,
        analyzed: 2,
        unavailable: 0,
        pending: 0,
        inFlight: 0,
        matched: 1,
        excluded: 1,
      },
      pauseReason: null,
      warnings: [
        'Scores are not probabilities of profit.',
        'Execution is conditional on the next session open.',
      ],
    },
    page: {
      kind: 'matches',
      offset: 0,
      limit: 20,
      total: 1,
      hasMore: false,
      items: [fixtureScreenMatch('AAPL')],
    },
  };
}

function serviceFor(value: Snapshot = snapshot()) {
  return {
    create: mock(async () => value),
    get: mock(async () => value),
    resume: mock(async () => value),
    pause: mock(async () => value),
    getPerformance: mock(async () => fixturePerformance()),
    refreshPerformance: mock(async () => fixturePerformance()),
  } satisfies MarketScreenService;
}

async function withMarketClient(
  service: MarketScreenService,
  check: (client: Client) => Promise<void>
): Promise<void> {
  const server = new McpServer({ name: 'market-screen-test', version: '1' });
  registerMarketScreenTools(server, service);
  const client = new Client({ name: 'market-screen-test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await check(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe('Finviz candidate input', () => {
  test.each([
    'https://finviz.com/screener',
    'https://finviz.com/screener?v=411&f=ind_stocksonly,cap_midover&r=1001',
    'https://finviz.com/screener.ashx?v=111&f=ind_stocksonly&o=-marketcap',
  ])('accepts public Finviz screener metadata: %s', (url) => {
    expect(isFinvizScreenSource(url)).toBe(true);
  });

  test.each([
    'http://finviz.com/screener',
    'https://finviz.com.evil.invalid/screener',
    'https://finviz.com@evil.invalid/screener',
    'https://name:secret@finviz.com/screener',
    'https://finviz.com:8443/screener',
    'https://finviz.com/screener#secret',
    'https://finviz.com/export.ashx',
    'https://finviz.com/api/v1/screener-export-csv',
    'https://finviz.com/screener?auth=secret',
    'https://finviz.com/screener?key=secret',
    'https://finviz.com/screener?token=secret',
    'https://finviz.com/screener?v=411&v=111',
    'https://finviz.com/screener?f=ind_stocksonly&f=cap_midover',
    'https://finviz.com/screener?f=%3Cscript%3E',
    'file:///tmp/finviz.csv',
    '/tmp/finviz.csv',
  ])('rejects private, unrelated or ambiguous source metadata: %s', (url) => {
    expect(isFinvizScreenSource(url)).toBe(false);
  });

  test('checks unique coverage before accepting a complete declaration', () => {
    const input = candidates();
    expect(createMarketScreenInput.safeParse(input).success).toBe(true);
    expect(
      createMarketScreenInput.safeParse({
        ...input,
        provenance: { ...input.provenance, completeness: 'complete' },
      }).success
    ).toBe(false);
    expect(
      createMarketScreenInput.safeParse({
        ...input,
        provenance: { ...input.provenance, sourceTotal: 2, completeness: 'complete' },
      }).success
    ).toBe(true);
    expect(
      createMarketScreenInput.safeParse({
        ...input,
        provenance: { ...input.provenance, sourceTotal: 1 },
      }).success
    ).toBe(false);
  });

  test('enforces the raw row bound before deduplication', () => {
    const input = candidates();
    expect(
      createMarketScreenInput.safeParse({ ...input, tickers: Array(15001).fill('AAPL') }).success
    ).toBe(false);
    expect(
      createMarketScreenInput.safeParse({ ...input, tickers: Array(15000).fill('AAPL') }).success
    ).toBe(true);
  });

  test('preserves exact source filters, explicit totals and source capture metadata', () => {
    const input = candidates();
    const invalidProvenance = [
      { filters: [...FILTERS].reverse() },
      { filters: ['ind_stocksonly'] },
      { filters: ['ind_stocksonly', 'sh_price_o5', 'secret'] },
      { sourceTotal: 0 },
      { sourceTotal: 3.5 },
      { overallTotal: 2 },
      { capturedAt: 'yesterday' },
      { pages: 0 },
      { pages: 1.5 },
      { completeness: 'verified' },
      { rootDirectory: '/tmp/jobs' },
    ];
    for (const override of invalidProvenance) {
      expect(
        createMarketScreenInput.safeParse({
          ...input,
          provenance: { ...input.provenance, ...override },
        }).success
      ).toBe(false);
    }
    expect(
      createMarketScreenInput.safeParse({
        tickers: ['AAPL'],
        provenance: {
          ...input.provenance,
          url: 'https://finviz.com/screener',
          filters: [],
          sourceTotal: 1,
          completeness: 'complete',
        },
      }).success
    ).toBe(true);
  });

  test('bounds pagination and rejects arbitrary local paths and execution options', () => {
    expect(getMarketScreenInput.parse({ jobId: JOB_ID })).toEqual({
      jobId: JOB_ID,
      kind: 'matches',
      offset: 0,
      limit: 20,
    });
    for (const override of [
      { jobId: '../../job.json' },
      { kind: 'all' },
      { offset: -1 },
      { offset: 15001 },
      { offset: 0.5 },
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { rootDirectory: '/tmp/jobs' },
    ]) {
      expect(getMarketScreenInput.safeParse({ jobId: JOB_ID, ...override }).success).toBe(false);
    }
    expect(
      controlMarketScreenInput.safeParse({ jobId: JOB_ID, action: 'resume', concurrency: 10 })
        .success
    ).toBe(false);
  });
});

describe('durable market-screen MCP tools', () => {
  test('discovers bounded schemas with separate mutation and read annotations', async () => {
    const service = serviceFor();
    await withMarketClient(service, async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'create_market_screen',
        'get_market_screen',
        'control_market_screen',
        'get_market_screen_performance',
        'refresh_market_screen_performance',
      ]);
      expect(tools[0]).toMatchObject({
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
        inputSchema: {
          additionalProperties: false,
          required: ['tickers', 'provenance'],
          properties: {
            tickers: { type: 'array', minItems: 1, maxItems: 15000 },
            decision: { default: 'BUY' },
            lookbackDays: { minimum: 730, maximum: 3650, default: 730 },
            autoStart: { type: 'boolean', default: true },
            provenance: { additionalProperties: false },
          },
        },
      });
      expect(tools[1]).toMatchObject({
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
        inputSchema: {
          properties: {
            offset: { minimum: 0, maximum: 15000, default: 0 },
            limit: { minimum: 1, maximum: 100, default: 20 },
          },
        },
      });
      expect(tools[2]).toMatchObject({
        annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
      });
      expect(tools[3]).toMatchObject({
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
        inputSchema: {
          additionalProperties: false,
          properties: {
            offset: { minimum: 0, maximum: 15000, default: 0 },
            limit: { minimum: 1, maximum: 100, default: 20 },
          },
        },
      });
      expect(tools[4]).toMatchObject({
        annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
        inputSchema: {
          additionalProperties: false,
          properties: { limit: { minimum: 1, maximum: 50, default: 20 } },
        },
      });
      expect(service.create).not.toHaveBeenCalled();
      expect(service.get).not.toHaveBeenCalled();
      expect(service.resume).not.toHaveBeenCalled();
    });
  });

  test('creates once with normalized symbols, defaults and unchanged partial provenance', async () => {
    const service = serviceFor();
    const input = candidates();
    await withMarketClient(service, async (client) => {
      const result = await client.callTool({ name: 'create_market_screen', arguments: input });
      expect(service.create).toHaveBeenCalledWith({
        ...input,
        tickers: ['AAPL', 'MSFT', 'AAPL'],
        decision: 'BUY',
        lookbackDays: 730,
        autoStart: true,
      });
      expect(service.create).toHaveBeenCalledTimes(1);
      expect(service.resume).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        isError: false,
        structuredContent: {
          job: { status: 'partial', universe: { collectedCount: 2, sourceTotal: 3 } },
        },
      });
      const text = JSON.stringify(result.content);
      expect(text).toContain('caller-declared partial');
      expect(text).toContain('does not independently verify Finviz coverage');
      expect(text).toContain('reported unfiltered total: 11702');
      expect(text).toContain('| AAPL | 2026-10-02 | BUY | 300.00 | 10.00 |');
      expect(text).toContain('Fixture gates passed');
      expect(text).toContain('not probabilities of profit');
      expect(text).toContain('conditional on the next session open');
    });
  });

  test('supports an explicit paused manifest preview without a second resume call', async () => {
    const value = snapshot();
    value.job.status = 'paused';
    value.job.startedAt = null;
    value.job.finishedAt = null;
    value.job.progress = {
      total: 2,
      analyzed: 0,
      unavailable: 0,
      pending: 2,
      inFlight: 0,
      matched: 0,
      excluded: 0,
    };
    value.page.items = [];
    value.page.total = 0;
    const service = serviceFor(value);
    await withMarketClient(service, async (client) => {
      const result = await client.callTool({
        name: 'create_market_screen',
        arguments: { ...candidates(), autoStart: false, decision: 'ALL', lookbackDays: 2920 },
      });
      expect(service.create).toHaveBeenCalledWith(
        expect.objectContaining({ autoStart: false, decision: 'ALL', lookbackDays: 2920 })
      );
      expect(service.resume).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        isError: false,
        structuredContent: { job: { status: 'paused' } },
      });
      expect(JSON.stringify(result.content)).toContain('candidate analysis is still incomplete');
    });
  });

  test('reads pages without resuming and renders high-score gate-blocked exclusions', async () => {
    const value = snapshot();
    value.page = {
      ...value.page,
      kind: 'excluded',
      offset: 20,
      limit: 100,
      hasMore: true,
      items: [fixtureScreenMatch('MSFT', 'HOLD')],
    };
    const service = serviceFor(value);
    await withMarketClient(service, async (client) => {
      await client.callTool({ name: 'get_market_screen', arguments: { jobId: JOB_ID } });
      expect(service.get).toHaveBeenCalledWith(JOB_ID, { kind: 'matches', offset: 0, limit: 20 });
      const result = await client.callTool({
        name: 'get_market_screen',
        arguments: { jobId: JOB_ID, kind: 'excluded', offset: 20, limit: 100 },
      });
      expect(service.get).toHaveBeenLastCalledWith(JOB_ID, {
        kind: 'excluded',
        offset: 20,
        limit: 100,
      });
      expect(service.resume).not.toHaveBeenCalled();
      const text = JSON.stringify(result.content);
      expect(text).toContain('| MSFT | 2026-10-02 | HOLD | 500.00 | 10.00 |');
      expect(text).toContain('Fixture trend gate blocked entry');
      expect(text).toContain('more pages available');
    });
  });

  test('renders unavailable ticker reasons as successful job reads', async () => {
    const value = snapshot();
    value.job.status = 'unavailable';
    value.page = {
      ...value.page,
      kind: 'unavailable',
      items: [{ ticker: 'BAD', reason: 'No usable completed sessions.', attempts: 1 }],
    };
    const service = serviceFor(value);
    await withMarketClient(service, async (client) => {
      const result = await client.callTool({
        name: 'get_market_screen',
        arguments: { jobId: JOB_ID, kind: 'unavailable' },
      });
      expect(result.isError).toBe(false);
      expect(JSON.stringify(result.content)).toContain('BAD: No usable completed sessions');
      expect(result.structuredContent).toMatchObject({ job: { status: 'unavailable' } });
    });
  });

  test('treats a completed empty result page as a normal no-match result', async () => {
    const value = snapshot();
    value.job.status = 'completed';
    value.job.universe.completeness = 'complete';
    value.job.universe.sourceTotal = 2;
    value.page.items = [];
    value.page.total = 0;
    const service = serviceFor(value);
    await withMarketClient(service, async (client) => {
      const result = await client.callTool({
        name: 'get_market_screen',
        arguments: { jobId: JOB_ID },
      });
      expect(result.isError).toBe(false);
      expect(JSON.stringify(result.content)).toContain('No rows on this result page');
      expect(JSON.stringify(result.content)).not.toContain(
        'candidate analysis is still incomplete'
      );
    });
  });

  test('routes resume and pause to the same durable job without waiting for a scan', async () => {
    const service = serviceFor();
    await withMarketClient(service, async (client) => {
      await client.callTool({
        name: 'control_market_screen',
        arguments: { jobId: JOB_ID, action: 'resume' },
      });
      await client.callTool({
        name: 'control_market_screen',
        arguments: { jobId: JOB_ID, action: 'pause' },
      });
      expect(service.resume).toHaveBeenCalledWith(JOB_ID);
      expect(service.pause).toHaveBeenCalledWith(JOB_ID);
      expect(service.create).not.toHaveBeenCalled();
    });
  });

  test('rejects invalid manifests and control paths before durable-state calls', async () => {
    const service = serviceFor();
    const input = candidates();
    await withMarketClient(service, async (client) => {
      for (const request of [
        {
          name: 'create_market_screen',
          arguments: { ...input, provenance: { ...input.provenance, completeness: 'complete' } },
        },
        { name: 'create_market_screen', arguments: { ...input, rootDirectory: '/tmp/jobs' } },
        { name: 'create_market_screen', arguments: { ...input, lookbackDays: 729 } },
        { name: 'create_market_screen', arguments: { ...input, decision: 'buy' } },
        { name: 'create_market_screen', arguments: { ...input, autoStart: 'false' } },
        { name: 'get_market_screen', arguments: { jobId: '../../job.json' } },
        { name: 'get_market_screen', arguments: { jobId: JOB_ID, limit: 101 } },
        { name: 'control_market_screen', arguments: { jobId: JOB_ID, action: 'delete' } },
        {
          name: 'control_market_screen',
          arguments: { jobId: JOB_ID, action: 'resume', rootDirectory: '/tmp/jobs' },
        },
      ]) {
        expect((await client.callTool(request)).isError).toBe(true);
      }
      expect(service.create).not.toHaveBeenCalled();
      expect(service.get).not.toHaveBeenCalled();
      expect(service.resume).not.toHaveBeenCalled();
      expect(service.pause).not.toHaveBeenCalled();
    });
  });

  test('sanitizes failures from create, get, resume and pause', async () => {
    const fail = mock(async () => {
      throw new Error(
        'https://provider.invalid/?token=fixture-secret /Users/private/jobs/job.json'
      );
    });
    await withMarketClient(
      {
        create: fail,
        get: fail,
        resume: fail,
        pause: fail,
        getPerformance: fail,
        refreshPerformance: fail,
      },
      async (client) => {
        for (const request of [
          { name: 'create_market_screen', arguments: candidates() },
          { name: 'get_market_screen', arguments: { jobId: JOB_ID } },
          { name: 'control_market_screen', arguments: { jobId: JOB_ID, action: 'resume' } },
          { name: 'control_market_screen', arguments: { jobId: JOB_ID, action: 'pause' } },
          { name: 'get_market_screen_performance', arguments: { jobId: JOB_ID } },
          { name: 'refresh_market_screen_performance', arguments: { jobId: JOB_ID } },
        ]) {
          const result = await client.callTool(request);
          expect(result.isError).toBe(true);
          expect(JSON.stringify(result)).toContain('job request could not be completed');
          expect(JSON.stringify(result)).not.toContain('fixture-secret');
          expect(JSON.stringify(result)).not.toContain('/Users/private');
          expect(JSON.stringify(result)).not.toContain('https://provider');
        }
      }
    );
  });

  test('reads saved paper outcomes and completed sample rates without requesting a refresh', async () => {
    const service = serviceFor();
    await withMarketClient(service, async (client) => {
      const result = await client.callTool({
        name: 'get_market_screen_performance',
        arguments: { jobId: JOB_ID.toUpperCase() },
      });
      expect(service.getPerformance).toHaveBeenCalledWith(JOB_ID, { offset: 0, limit: 20 });
      expect(service.refreshPerformance).not.toHaveBeenCalled();
      expect(service.resume).not.toHaveBeenCalled();
      expect(service.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({ isError: false, structuredContent: fixturePerformance() });
      const text = JSON.stringify(result.content);
      expect(text).toContain('not actual fills');
      expect(text).toContain('fifth session close');
      expect(text).toContain('100.00% (n=1 completed)');
      expect(text).toContain('Pending entry: 1; open observations: 1; unavailable: 1');
      expect(text).toContain(
        '| AAPL | 2026-10-02 | 2026-10-05T13:00:00.000Z | completed | 2026-10-05 | 100.00 | 2026-10-09 | 102.00 | 1.90% | win |'
      );
      await client.callTool({
        name: 'get_market_screen_performance',
        arguments: { jobId: JOB_ID, offset: 20, limit: 100 },
      });
      expect(service.getPerformance).toHaveBeenLastCalledWith(JOB_ID, { offset: 20, limit: 100 });
    });
  });

  test('shows no percentage for an empty closed sample and retains pending/unavailable observations', async () => {
    const value = fixturePerformance();
    value.summary.completed = 0;
    value.summary.wins = 0;
    value.summary.totalRecommendations = 3;
    value.summary.winRatePct = null;
    value.summary.averageNetReturnPct = null;
    value.page.items = value.page.items.filter((row) => row.status !== 'completed');
    value.page.total = 3;
    const service = { ...serviceFor(), getPerformance: mock(async () => value) };
    await withMarketClient(service, async (client) => {
      const result = await client.callTool({
        name: 'get_market_screen_performance',
        arguments: { jobId: JOB_ID },
      });
      const text = JSON.stringify(result.content);
      expect(text).toContain('N/A (n=0 completed)');
      expect(text).not.toContain('0.00%');
      expect(text).toContain('unavailable: 1');
      expect(result.isError).toBe(false);
    });
  });

  test('distinguishes an observed zero positive-return rate from an empty sample', async () => {
    const value = fixturePerformance();
    value.summary.wins = 0;
    value.summary.losses = 1;
    value.summary.winRatePct = 0;
    value.summary.averageNetReturnPct = -1.1;
    value.page.items[0] = {
      ...value.page.items[0]!,
      exitPrice: 99,
      grossReturnPct: -1,
      netReturnPct: -1.1,
      outcome: 'loss',
    };
    await withMarketClient(
      { ...serviceFor(), getPerformance: mock(async () => value) },
      async (client) => {
        const result = await client.callTool({
          name: 'get_market_screen_performance',
          arguments: { jobId: JOB_ID },
        });
        expect(JSON.stringify(result.content)).toContain('0.00% (n=1 completed)');
        expect(JSON.stringify(result.content)).toContain('-1.10%');
      }
    );
  });

  test('starts performance refresh separately from screening and returns bounded background progress', async () => {
    const value = fixturePerformance();
    value.refresh = { status: 'running', selected: 3, processed: 0, reason: null };
    const service = { ...serviceFor(), refreshPerformance: mock(async () => value) };
    await withMarketClient(service, async (client) => {
      const result = await client.callTool({
        name: 'refresh_market_screen_performance',
        arguments: { jobId: JOB_ID },
      });
      expect(service.refreshPerformance).toHaveBeenCalledWith(JOB_ID, { limit: 20 });
      expect(result).toMatchObject({
        isError: false,
        structuredContent: { refresh: { status: 'running', selected: 3, processed: 0 } },
      });
      expect(JSON.stringify(result.content)).toContain('Refresh: running; 0/3');
      expect(service.resume).not.toHaveBeenCalled();
      expect(service.getPerformance).not.toHaveBeenCalled();
      await client.callTool({
        name: 'refresh_market_screen_performance',
        arguments: { jobId: JOB_ID, limit: 50 },
      });
      expect(service.refreshPerformance).toHaveBeenLastCalledWith(JOB_ID, { limit: 50 });
    });
  });

  test('rejects unsupported performance inputs before saved reads or price updates', async () => {
    const service = serviceFor();
    expect(getMarketScreenPerformanceInput.safeParse({ jobId: JOB_ID }).data).toEqual({
      jobId: JOB_ID,
      offset: 0,
      limit: 20,
    });
    expect(refreshMarketScreenPerformanceInput.safeParse({ jobId: JOB_ID }).data).toEqual({
      jobId: JOB_ID,
      limit: 20,
    });
    await withMarketClient(service, async (client) => {
      for (const request of [
        { name: 'get_market_screen_performance', arguments: { jobId: '../../jobs' } },
        { name: 'get_market_screen_performance', arguments: { jobId: JOB_ID, offset: 15001 } },
        { name: 'get_market_screen_performance', arguments: { jobId: JOB_ID, limit: 101 } },
        { name: 'get_market_screen_performance', arguments: { jobId: JOB_ID, refresh: true } },
        { name: 'refresh_market_screen_performance', arguments: { jobId: JOB_ID, limit: 51 } },
        { name: 'refresh_market_screen_performance', arguments: { jobId: JOB_ID, limit: 0 } },
        { name: 'refresh_market_screen_performance', arguments: { jobId: JOB_ID, limit: 1.5 } },
        { name: 'refresh_market_screen_performance', arguments: { jobId: JOB_ID, offset: 20 } },
        {
          name: 'refresh_market_screen_performance',
          arguments: { jobId: JOB_ID, rootDirectory: '/tmp/jobs' },
        },
      ])
        expect((await client.callTool(request)).isError).toBe(true);
      expect(service.getPerformance).not.toHaveBeenCalled();
      expect(service.refreshPerformance).not.toHaveBeenCalled();
      expect(service.resume).not.toHaveBeenCalled();
    });
  });
});
