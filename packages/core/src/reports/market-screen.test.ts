import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import {
  type CreateMarketScreenOptions,
  createMarketScreenJob,
  getMarketScreenJob,
  listMarketScreenJobs,
  MarketScreenJobNotFoundError,
  type MarketScreenJobSnapshot,
  pauseMarketScreenJob,
  runMarketScreenJob,
} from '@/reports/market-screen';
import { readMarketScreenLease, writeMarketScreenJson } from '@/reports/market-screen-store';
import { projectMatch } from '@/reports/stock-screen';
import type { analyzeTickerContext, TickerAnalysisContext } from '@/services/ticker-analysis';
import type { PipelineResult } from '@/types';
import type { buildStockReportWhatsAppNotification } from '@/utils/stock-report-alerts';
import type { sendWhatsAppNotification } from '@/utils/whatsapp';

const storeHooks = vi.hoisted(() => ({
  beforeRead: undefined as undefined | ((file: string) => Promise<void>),
  beforeWrite: undefined as undefined | ((file: string, value: unknown) => Promise<void>),
}));

vi.mock('@/reports/market-screen-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/reports/market-screen-store')>();
  return {
    ...actual,
    readMarketScreenJson: async (file: string) => {
      await storeHooks.beforeRead?.(file);
      return actual.readMarketScreenJson(file);
    },
    writeMarketScreenJson: async (file: string, value: unknown) => {
      await storeHooks.beforeWrite?.(file, value);
      return actual.writeMarketScreenJson(file, value);
    },
  };
});

function context(
  ticker: string,
  decision: PipelineResult['finalDecision'] = 'BUY',
  buyScore = 250,
  sellScore = 5
): TickerAnalysisContext {
  return {
    result: {
      ticker,
      date: '2026-01-02',
      close: 100,
      volume: 2_000_000,
      rsi: 50,
      stochasticK: 50,
      bbLower: 98,
      bbUpper: 102,
      donchLower: 98,
      donchUpper: 102,
      williamsR: -50,
      fearGreed: null,
      patterns: [],
      score: buyScore,
      opinion: decision,
      atr: 2,
      stopLoss: 97,
      takeProfit: 106,
      trailingStop: 97,
      trailingStart: 101,
      macd: 0,
      macdSignal: 0,
      macdHistogram: 0,
      sma20: 100,
      ema20: 100,
    },
    pipelineResult: {
      ticker,
      finalDecision: decision,
      score: buyScore,
      buyScore,
      sellScore,
      confidence: 60,
      gateResults: {
        trend: { passed: true, regime: 'uptrend', strength: 100, reason: 'upward trend' },
        confluence: { passed: true, activeIndicators: 5, totalIndicators: 6, ratio: 5 / 6 },
        reversal: { status: 'confirmed', trigger: 'both' },
        institutional: {
          score: 0.8,
          passed: true,
          components: { rsSpy: 1, rsSector: 1, vwap: 1, breakoutVol: 1, liquidity: 1, earnings: 0 },
        },
      },
    },
    dailyPrices: [],
    spyCandles: [],
    sectorCandles: [],
    sectorETF: null,
    config: DEFAULT_QUALITY_PIPELINE_CONFIG,
  };
}

function input(
  tickers = ['ONE', 'TWO'],
  overrides: Partial<CreateMarketScreenOptions> = {}
): CreateMarketScreenOptions {
  const count = new Set(tickers.map((ticker) => ticker.trim().toUpperCase())).size;
  return {
    tickers,
    provenance: {
      source: 'Finviz',
      url: 'https://finviz.com/screener?v=411&f=ind_stocksonly',
      filters: ['ind_stocksonly'],
      sourceTotal: count,
      overallTotal: Math.max(11702, count),
      pages: 1,
      capturedAt: new Date(Date.now() - 1_000).toISOString(),
      completeness: 'complete',
    },
    ...overrides,
  };
}

const delay = (milliseconds = 5) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function waitUntil(check: () => Promise<boolean> | boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (await check()) return;
    await delay();
  }
  throw new Error('Fixture did not settle');
}

describe('durable Finviz candidate jobs', () => {
  let root: string;
  let analyze: ReturnType<typeof vi.fn<typeof analyzeTickerContext>>;
  let notify: ReturnType<typeof vi.fn<typeof sendWhatsAppNotification>>;
  let ids: string[];
  let releases: Array<() => void>;
  const deps = () => ({
    rootDirectory: root,
    analyzeTickerContext: analyze,
    minIntervalMs: 0,
    sendWhatsAppNotification: notify,
    isWhatsAppNotificationConfigured: async () => false,
  });

  async function create(options = input()) {
    const result = await createMarketScreenJob(options, deps());
    ids.push(result.job.id);
    return result;
  }

  async function settled(id: string): Promise<MarketScreenJobSnapshot> {
    let latest: MarketScreenJobSnapshot | undefined;
    await waitUntil(async () => {
      latest = await getMarketScreenJob(id, {}, deps());
      return (
        ['completed', 'partial', 'unavailable'].includes(latest.job.status) &&
        latest.job.progress.inFlight === 0 &&
        (await readMarketScreenLease(root)) === null
      );
    });
    if (!latest) throw new Error('Missing fixture snapshot');
    return latest;
  }

  function blocked() {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    releases.push(release);
    return { gate, release };
  }

  beforeEach(async () => {
    storeHooks.beforeRead = undefined;
    storeHooks.beforeWrite = undefined;
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'stock-checker-market-job-')));
    ids = [];
    releases = [];
    analyze = vi
      .fn<typeof analyzeTickerContext>()
      .mockImplementation(async (ticker) => context(ticker));
    notify = vi
      .fn<typeof sendWhatsAppNotification>()
      .mockResolvedValue({ status: 'disabled', reason: 'not-configured' });
  });

  it('atomically publishes a frozen forward policy only alongside matched final BUY rows', async () => {
    analyze.mockImplementation(async (ticker) =>
      context(ticker, ticker === 'ONE' ? 'BUY' : ticker === 'TWO' ? 'SELL' : 'HOLD')
    );
    const created = await create(input(['ONE', 'TWO', 'THREE'], { decision: 'ALL' }));
    await settled(created.job.id);
    const rows = await Promise.all(
      [0, 1, 2].map(async (index) =>
        JSON.parse(
          await readFile(
            path.join(
              root,
              created.job.id,
              `results/matches/${String(index).padStart(8, '0')}.json`
            ),
            'utf8'
          )
        )
      )
    );
    expect(rows[0].forwardPerformance).toMatchObject({
      schemaVersion: 1,
      recommendedAt: rows[0].completedAt,
      dataAsOf: rows[0].item.dataAsOf,
      policy: { mode: 'forward-paper', horizonSessions: 5, costBpsRoundTrip: 10 },
    });
    expect(rows[1].forwardPerformance).toBeUndefined();
    expect(rows[2].forwardPerformance).toBeUndefined();
  });

  afterEach(async () => {
    storeHooks.beforeRead = undefined;
    storeHooks.beforeWrite = undefined;
    for (const id of ids) {
      try {
        await pauseMarketScreenJob(id, deps());
      } catch {
        /* Failed setup fixtures may have intentionally corrupt controls. */
      }
    }
    for (const release of releases) release();
    await waitUntil(async () => (await readMarketScreenLease(root)) === null);
    await rm(root, { recursive: true, force: true });
  });

  it('saves a paused frozen candidate manifest with no analysis or huge response payload', async () => {
    const result = await create(input([' one ', 'ONE', 'TWO'], { autoStart: false }));

    expect(result.job.status).toBe('paused');
    expect(result.job.universe).toMatchObject({
      source: 'finviz-candidates',
      inputCount: 3,
      collectedCount: 2,
      sourceTotal: 2,
      overallTotal: 11702,
      filters: ['ind_stocksonly'],
      pages: 1,
      completeness: 'complete',
    });
    expect(result.job.criteria).toMatchObject({
      decision: 'BUY',
      lookbackDays: 730,
      concurrency: 2,
    });
    expect(result.job.progress).toEqual({
      total: 2,
      analyzed: 0,
      unavailable: 0,
      pending: 2,
      inFlight: 0,
      matched: 0,
      excluded: 0,
    });
    expect(
      JSON.parse(await readFile(path.join(root, result.job.id, 'manifest.json'), 'utf8')).tickers
    ).toEqual(['ONE', 'TWO']);
    expect(result.job.universe).not.toHaveProperty('tickers');
    expect(analyze).not.toHaveBeenCalled();
    expect(await readMarketScreenLease(root)).toBeNull();
  });

  it('returns immediately while the actual analysis promises remain blocked, then finishes without holding a tool call open', async () => {
    const block = blocked();
    analyze.mockImplementation(async (ticker) => {
      await block.gate;
      return context(ticker);
    });

    const started = await create();
    expect(started.job.status).toBe('running');
    await waitUntil(() => analyze.mock.calls.length === 2);
    expect(await readMarketScreenLease(root)).toMatchObject({
      pid: process.pid,
      jobId: started.job.id,
    });
    block.release();
    const complete = await settled(started.job.id);

    expect(complete.job.status).toBe('completed');
    expect(complete.job.progress).toEqual({
      total: 2,
      analyzed: 2,
      unavailable: 0,
      pending: 0,
      inFlight: 0,
      matched: 2,
      excluded: 0,
    });
    expect(analyze.mock.calls.map((call) => call.slice(1))).toEqual([
      [null, { lookbackDays: 730 }],
      [null, { lookbackDays: 730 }],
    ]);
  });

  it('freezes validated input provenance and candidates before asynchronous storage starts', async () => {
    const options = input(['ONE', 'TWO'], { autoStart: false });
    const pending = createMarketScreenJob(options, deps());
    options.tickers.push('THREE');
    options.provenance.filters.push('cap_largeover');
    options.provenance.sourceTotal = 3;
    options.autoStart = true;
    const created = await pending;
    ids.push(created.job.id);

    expect(created.job.status).toBe('paused');
    expect(created.job.universe).toMatchObject({
      filters: ['ind_stocksonly'],
      inputCount: 2,
      sourceTotal: 2,
      collectedCount: 2,
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(
      JSON.parse(await readFile(path.join(root, created.job.id, 'manifest.json'), 'utf8')).tickers
    ).toEqual(['ONE', 'TWO']);
  });

  it('preserves partial Finviz collection even when every supplied candidate is successfully analyzed', async () => {
    const options = input();
    options.provenance = { ...options.provenance, sourceTotal: 1669, completeness: 'partial' };
    const started = await create(options);
    const complete = await settled(started.job.id);

    expect(complete.job.status).toBe('partial');
    expect(complete.job.universe).toMatchObject({
      sourceTotal: 1669,
      collectedCount: 2,
      completeness: 'partial',
      overallTotal: 11702,
    });
    expect(complete.job.warnings.join(' ')).toContain('Only 2 of 1669');
    expect(complete.job.progress.analyzed).toBe(2);
  });

  it('reuses final engine decisions instead of classifying a high-score gated HOLD as BUY', async () => {
    analyze.mockImplementation(async (ticker) => {
      const value = context(
        ticker,
        ticker === 'BLOCKED' ? 'HOLD' : 'BUY',
        ticker === 'BLOCKED' ? 350 : 230
      );
      if (ticker === 'BLOCKED') {
        value.pipelineResult.qualityBlocked = true;
        value.result.opinion = 'BUY';
      } else value.pipelineResult.gateResults.institutional.passed = false;
      return value;
    });
    const started = await create(input(['BLOCKED', 'QUALIFIED']));
    const complete = await settled(started.job.id);
    const excluded = await getMarketScreenJob(started.job.id, { kind: 'excluded' }, deps());

    expect(complete.page.items.map((row) => row.ticker)).toEqual(['QUALIFIED']);
    expect(excluded.page.items).toMatchObject([
      {
        ticker: 'BLOCKED',
        decision: 'HOLD',
        buyScore: 350,
        execution: { entry: { eligible: false, price: null } },
      },
    ]);
    expect(complete.job.progress).toMatchObject({ analyzed: 2, matched: 1, excluded: 1 });
    expect(
      (complete.page.items[0] as ReturnType<typeof projectMatch>).execution.entry.price
    ).toBeNull();
  });

  it('keeps provider failures unavailable and marks mixed successes partial without exposing private errors', async () => {
    analyze.mockImplementation(async (ticker) => {
      if (ticker === 'ERROR') throw new Error('https://provider.example/?apikey=fixture-secret');
      if (ticker === 'EMPTY') return null;
      return context(ticker, 'HOLD');
    });
    const started = await create(input(['GOOD', 'ERROR', 'EMPTY']));
    const complete = await settled(started.job.id);
    const errors = await getMarketScreenJob(started.job.id, { kind: 'unavailable' }, deps());

    expect(complete.job.status).toBe('partial');
    expect(complete.job.progress).toMatchObject({
      analyzed: 1,
      unavailable: 2,
      matched: 0,
      excluded: 1,
    });
    expect(errors.page.items.map((row) => row.ticker)).toEqual(['ERROR', 'EMPTY']);
    expect(errors.page.items).toMatchObject([{ attempts: 1 }, { attempts: 1 }]);
    expect(JSON.stringify(errors)).not.toContain('fixture-secret');
    expect(JSON.stringify(errors)).not.toContain('provider.example');
  });

  it('distinguishes a complete empty BUY screen from a fully unavailable analysis run', async () => {
    analyze.mockImplementation(async (ticker) => context(ticker, 'HOLD'));
    const holds = await create();
    const first = await settled(holds.job.id);
    expect(first.job.status).toBe('completed');
    expect(first.page.items).toEqual([]);
    expect(first.job.progress.excluded).toBe(2);

    analyze.mockResolvedValue(null);
    const failed = await create();
    const second = await settled(failed.job.id);
    expect(second.job.status).toBe('unavailable');
    expect(second.job.progress).toMatchObject({
      analyzed: 0,
      unavailable: 2,
      pending: 0,
      inFlight: 0,
    });
  });

  it('sorts and pages matches by the existing BUY or SELL ranking without returning the full candidate array', async () => {
    const scores: Record<string, number> = { LOW: 200, ZZZ: 300, AAA: 300, MID: 250 };
    analyze.mockImplementation(async (ticker) =>
      context(ticker, 'SELL', 500 - scores[ticker], scores[ticker])
    );
    const started = await create(input(['LOW', 'ZZZ', 'AAA', 'MID'], { decision: 'SELL' }));
    await settled(started.job.id);
    const page = await getMarketScreenJob(started.job.id, { offset: 1, limit: 2 }, deps());

    expect(page.page).toMatchObject({
      kind: 'matches',
      offset: 1,
      limit: 2,
      total: 4,
      hasMore: true,
    });
    expect(page.page.items.map((row) => row.ticker)).toEqual(['ZZZ', 'MID']);
    expect(page.job.universe).not.toHaveProperty('tickers');
  });

  it('owns exactly two global analysis slots across duplicate runs, pauses, resumes, and another job', async () => {
    let active = 0;
    let peak = 0;
    const block = blocked();
    analyze.mockImplementation(async (ticker) => {
      active++;
      peak = Math.max(peak, active);
      await block.gate;
      active--;
      return context(ticker);
    });
    const first = await create(input(['ONE', 'TWO', 'THREE', 'FOUR']));
    await waitUntil(() => analyze.mock.calls.length === 2);
    await Promise.all([
      runMarketScreenJob(first.job.id, deps()),
      runMarketScreenJob(first.job.id, { ...deps() }),
    ]);
    const paused = await pauseMarketScreenJob(first.job.id, deps());
    expect(paused.job.status).toBe('paused');
    expect(paused.job.progress.inFlight).toBe(2);
    const second = await create(input(['OTHER']));
    expect(second.job.status).toBe('paused');
    expect(second.job.pauseReason).toContain('Another market-screen job');
    await runMarketScreenJob(first.job.id, deps());
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(peak).toBe(2);
    block.release();
    await settled(first.job.id);
    await runMarketScreenJob(second.job.id, deps());
    await settled(second.job.id);
    expect(analyze).toHaveBeenCalledTimes(5);
    expect(peak).toBe(2);
  });

  it('checkpoints in-progress results after pause, then resumes only unfinished candidates', async () => {
    const block = blocked();
    analyze.mockImplementation(async (ticker) => {
      await block.gate;
      return context(ticker);
    });
    const started = await create(input(['ONE', 'TWO', 'THREE', 'FOUR']));
    await waitUntil(() => analyze.mock.calls.length === 2);
    await pauseMarketScreenJob(started.job.id, deps());
    block.release();
    await waitUntil(async () => (await readMarketScreenLease(root)) === null);
    const paused = await getMarketScreenJob(started.job.id, {}, deps());
    expect(paused.job.progress).toMatchObject({ analyzed: 2, pending: 2, inFlight: 0 });
    await runMarketScreenJob(started.job.id, deps());
    const complete = await settled(started.job.id);

    expect(complete.job.progress.analyzed).toBe(4);
    expect(analyze.mock.calls.map((call) => call[0])).toEqual(['ONE', 'TWO', 'THREE', 'FOUR']);
    for (const kind of ['matches', 'excluded', 'unavailable']) {
      expect(
        (await readdir(path.join(root, started.job.id, 'results', kind))).some((name) =>
          name.endsWith('.tmp')
        )
      ).toBe(false);
    }
  });

  it('recovers a dead owner, persisted terminal rows and stale in-flight counts without repeating saved analyses', async () => {
    const created = await create(input(['ONE', 'TWO', 'THREE'], { autoStart: false }));
    const id = created.job.id;
    await writeMarketScreenJson(path.join(root, id, 'results/matches/00000000.json'), {
      index: 0,
      kind: 'matches',
      completedAt: new Date().toISOString(),
      item: projectMatch('ONE', context('ONE')),
    });
    await writeMarketScreenJson(path.join(root, id, 'state.json'), {
      ...created.job,
      status: 'running',
      progress: { ...created.job.progress, pending: 1, inFlight: 2 },
    });
    await writeMarketScreenJson(path.join(root, id, 'control.json'), {
      desiredStatus: 'running',
      reason: null,
    });
    await writeMarketScreenJson(path.join(root, '.runner.lock', 'owner.json'), {
      pid: 2_147_483_647,
      token: randomUUID(),
      jobId: id,
      createdAt: new Date().toISOString(),
    });

    const stale = await getMarketScreenJob(id, {}, deps());
    expect(stale.job.status).toBe('paused');
    expect(stale.job.pauseReason).toContain('No worker is active');
    expect(stale.job.progress).toMatchObject({ analyzed: 1, matched: 1, pending: 2, inFlight: 0 });
    await runMarketScreenJob(id, deps());
    const complete = await settled(id);
    expect(complete.job.progress.analyzed).toBe(3);
    expect(analyze.mock.calls.map((call) => call[0])).toEqual(['TWO', 'THREE']);
  });

  it('pauses rate-limited work without retrying the failed ticker or launching the remaining queue', async () => {
    const block = blocked();
    analyze.mockImplementation(async (ticker) => {
      if (ticker === 'ONE')
        throw Object.assign(new Error('429 token=fixture-secret'), { status: 429 });
      await block.gate;
      return context(ticker);
    });
    const started = await create(input(['ONE', 'TWO', 'THREE', 'FOUR']));
    await waitUntil(
      async () => (await getMarketScreenJob(started.job.id, {}, deps())).job.status === 'paused'
    );
    block.release();
    await waitUntil(async () => (await readMarketScreenLease(root)) === null);
    const paused = await getMarketScreenJob(started.job.id, { kind: 'unavailable' }, deps());

    expect(paused.job.status).toBe('paused');
    expect(paused.job.pauseReason).toContain('without automatic retries');
    expect(analyze.mock.calls.every((call) => ['ONE', 'TWO'].includes(call[0]))).toBe(true);
    expect(analyze.mock.calls.filter((call) => call[0] === 'ONE')).toHaveLength(1);
    expect(paused.page.items).toMatchObject([{ ticker: 'ONE', attempts: 1 }]);
    expect(JSON.stringify(paused)).not.toContain('fixture-secret');
  });

  it('pauses after five consecutive unavailable completions, drains the two real workers, and resumes only unfinished candidates', async () => {
    analyze.mockResolvedValue(null);
    const started = await create(input(Array.from({ length: 12 }, (_, index) => `P${index}`)));
    await waitUntil(async () => (await readMarketScreenLease(root)) === null);
    const paused = await getMarketScreenJob(started.job.id, { kind: 'unavailable' }, deps());

    expect(paused.job.status).toBe('paused');
    expect(paused.job.pauseReason).toContain('Consecutive unavailable analyses');
    expect(paused.job.pauseReason).not.toMatch(/429|rate.limit/i);
    expect(paused.job.progress.unavailable).toBeGreaterThanOrEqual(5);
    expect(paused.job.progress.unavailable).toBeLessThanOrEqual(6);
    expect(paused.job.progress.inFlight).toBe(0);
    expect(paused.job.progress.pending).toBeGreaterThanOrEqual(6);
    const completedTickers = analyze.mock.calls.map((call) => call[0]);
    analyze.mockImplementation(async (ticker) => context(ticker));
    await runMarketScreenJob(started.job.id, deps());
    const complete = await settled(started.job.id);

    expect(complete.job.status).toBe('partial');
    expect(analyze).toHaveBeenCalledTimes(12);
    for (const ticker of completedTickers)
      expect(analyze.mock.calls.filter((call) => call[0] === ticker)).toHaveLength(1);
  });

  it('resets the consecutive unavailable guard after a usable completion', async () => {
    const secondWorker = blocked();
    analyze.mockImplementation(async (ticker) => {
      if (ticker === 'P1') {
        await secondWorker.gate;
        return context(ticker);
      }
      return ticker === 'P5' ? context(ticker) : null;
    });
    const started = await create(input(Array.from({ length: 9 }, (_, index) => `P${index}`)));
    await waitUntil(() => analyze.mock.calls.length === 9);
    secondWorker.release();
    const complete = await settled(started.job.id);

    expect(complete.job.status).toBe('partial');
    expect(complete.job.progress).toMatchObject({ analyzed: 2, unavailable: 7, pending: 0 });
    expect(analyze).toHaveBeenCalledTimes(9);
  });

  it('honors another process’s persisted resume request while paused workers are finalizing', async () => {
    const analyses = blocked();
    const finalCheckpoint = blocked();
    let finalizing = false;
    analyze.mockImplementation(async (ticker) => {
      await analyses.gate;
      return context(ticker);
    });
    const started = await create(input(['ONE', 'TWO', 'THREE', 'FOUR']));
    await waitUntil(() => analyze.mock.calls.length === 2);
    storeHooks.beforeWrite = async (file, value) => {
      const saved = value as MarketScreenJobSnapshot['job'];
      if (
        file.endsWith('state.json') &&
        saved.status === 'paused' &&
        saved.progress.inFlight === 0 &&
        !finalizing
      ) {
        finalizing = true;
        await finalCheckpoint.gate;
      }
    };
    await pauseMarketScreenJob(started.job.id, deps());
    analyses.release();
    await waitUntil(() => finalizing);
    // External MCP processes share disk control, not the owner’s module-local runtime map.
    await writeMarketScreenJson(path.join(root, started.job.id, 'control.json'), {
      desiredStatus: 'running',
      reason: null,
    });
    expect(analyze).toHaveBeenCalledTimes(2);
    finalCheckpoint.release();
    const complete = await settled(started.job.id);

    expect(complete.job.status).toBe('completed');
    expect(analyze.mock.calls.map((call) => call[0])).toEqual(['ONE', 'TWO', 'THREE', 'FOUR']);
  });

  it('enforces minimum per-worker pacing while preserving the two-worker global limit', async () => {
    const nativeSetTimeout = globalThis.setTimeout;
    const waitForIO = async (check: () => Promise<boolean> | boolean) => {
      for (let attempt = 0; attempt < 500; attempt++) {
        if (await check()) return;
        await new Promise<void>((resolve) => nativeSetTimeout(resolve, 5));
      }
      throw new Error('Pacing fixture did not settle');
    };
    const gates: Record<string, ReturnType<typeof blocked>> = {
      ONE: blocked(),
      TWO: blocked(),
      THREE: blocked(),
      FOUR: blocked(),
    };
    const starts = new Map<string, number>();
    let active = 0;
    let peak = 0;
    const initialTime = Date.now();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(initialTime);
    analyze.mockImplementation(async (ticker) => {
      starts.set(ticker, Date.now() - initialTime);
      active++;
      peak = Math.max(peak, active);
      // Filesystem checkpoints can stagger the initial workers. Hold both analyses
      // and make that skew explicit instead of comparing unrelated worker clocks.
      if (ticker === 'ONE') vi.setSystemTime(initialTime + 20);
      try {
        await gates[ticker].gate;
        return context(ticker);
      } finally {
        active--;
      }
    });
    try {
      const started = await createMarketScreenJob(input(['ONE', 'TWO', 'THREE', 'FOUR']), {
        ...deps(),
        minIntervalMs: 50,
      });
      ids.push(started.job.id);
      await waitForIO(() => starts.size === 2);
      expect(starts.get('ONE')).toBe(0);
      expect(starts.get('TWO')).toBe(20);

      // TWO stays blocked, so THREE must reuse ONE's worker at its own t=50.
      gates.ONE.release();
      await waitForIO(() => vi.getTimerCount() === 1);
      await vi.advanceTimersByTimeAsync(29);
      expect(starts.has('THREE')).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await waitForIO(() => starts.has('THREE'));
      expect(starts.get('THREE')).toBe(50);

      // THREE now stays blocked, forcing FOUR onto TWO's worker at t=70.
      gates.TWO.release();
      await waitForIO(() => vi.getTimerCount() === 1);
      await vi.advanceTimersByTimeAsync(19);
      expect(starts.has('FOUR')).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await waitForIO(() => starts.has('FOUR'));
      expect(starts.get('FOUR')).toBe(70);
      expect((starts.get('THREE') as number) - (starts.get('ONE') as number)).toBe(50);
      expect((starts.get('FOUR') as number) - (starts.get('TWO') as number)).toBe(50);
      expect(peak).toBe(2);
      expect(active).toBe(2);

      gates.THREE.release();
      gates.FOUR.release();
      await waitForIO(async () => (await readMarketScreenLease(root)) === null);
      expect((await getMarketScreenJob(started.job.id, {}, deps())).job.status).toBe('completed');
      expect(analyze).toHaveBeenCalledTimes(4);
    } finally {
      for (const gate of Object.values(gates)) gate.release();
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it('releases an acquired lease if control-file setup fails before any worker starts', async () => {
    const created = await create(input(['ONE'], { autoStart: false }));
    const control = path.join(root, created.job.id, 'control.json');
    await rm(control);
    await mkdir(control);

    await expect(runMarketScreenJob(created.job.id, deps())).rejects.toThrow();
    expect(await readMarketScreenLease(root)).toBeNull();
    expect(analyze).not.toHaveBeenCalled();
  });

  it('retains the lease after one worker’s result write fails until the other real analysis settles', async () => {
    const first = blocked();
    const second = blocked();
    analyze.mockImplementation(async (ticker) => {
      await (ticker === 'ONE' ? first.gate : second.gate);
      return null;
    });
    const started = await create(input(['ONE', 'TWO', 'THREE']));
    await waitUntil(() => analyze.mock.calls.length === 2);
    const resultDirectory = path.join(root, started.job.id, 'results/unavailable');
    await rm(resultDirectory, { recursive: true });
    await writeFile(resultDirectory, 'fixture I/O failure');
    first.release();
    await delay(25);
    expect(await readMarketScreenLease(root)).toMatchObject({ jobId: started.job.id });
    // Restore the directory so status/control reads can run while the second analysis remains blocked.
    await rm(resultDirectory);
    await mkdir(resultDirectory);
    await runMarketScreenJob(started.job.id, deps());
    expect(analyze).toHaveBeenCalledTimes(2);
    second.release();
    await waitUntil(async () => (await readMarketScreenLease(root)) === null);
    expect(analyze).toHaveBeenCalledTimes(2);
    expect((await getMarketScreenJob(started.job.id, {}, deps())).job.status).toBe('paused');
  });

  it('persists concurrent completions without losing progress counters or repeating terminal errors on resume', async () => {
    analyze.mockImplementation(async (ticker) => (ticker === 'P5' ? null : context(ticker)));
    const started = await create(input(Array.from({ length: 12 }, (_, index) => `P${index}`)));
    const complete = await settled(started.job.id);
    await runMarketScreenJob(started.job.id, deps());
    const disk = JSON.parse(await readFile(path.join(root, started.job.id, 'state.json'), 'utf8'));

    expect(complete.job.progress).toEqual({
      total: 12,
      analyzed: 11,
      unavailable: 1,
      pending: 0,
      inFlight: 0,
      matched: 11,
      excluded: 0,
    });
    expect(disk.progress).toEqual(complete.job.progress);
    expect(analyze).toHaveBeenCalledTimes(12);
  });

  it('accepts 15000 candidates as a paused manifest while keeping returned status small', async () => {
    const created = await create(
      input(
        Array.from({ length: 15000 }, (_, index) => `P${index}`),
        { autoStart: false }
      )
    );

    expect(created.job.progress.total).toBe(15000);
    expect(JSON.stringify(created).length).toBeLessThan(5000);
    expect(analyze).not.toHaveBeenCalled();
  });

  it.each(['/screener', '/screener.ashx'])(
    'accepts the public Finviz URL route %s',
    async (route) => {
      const options = input(['ONE'], { autoStart: false });
      options.provenance.url = `https://finviz.com${route}?v=411&f=ind_stocksonly`;
      expect((await create(options)).job.status).toBe('paused');
    }
  );

  it.each([
    (value: CreateMarketScreenOptions) => {
      value.tickers = [];
    },
    (value: CreateMarketScreenOptions) => {
      value.tickers = Array(15001).fill('ONE');
    },
    (value: CreateMarketScreenOptions) => {
      value.tickers = ['ONE', '../BAD'];
    },
    (value: CreateMarketScreenOptions) => {
      value.tickers = ['A'.repeat(33)];
    },
    (value: CreateMarketScreenOptions) => {
      value.tickers = ['ONE', 'one'];
      value.provenance.sourceTotal = 2;
    },
    (value: CreateMarketScreenOptions) => {
      value.provenance.sourceTotal = 1669;
    },
    (value: CreateMarketScreenOptions) => {
      value.provenance.sourceTotal = 1;
    },
    (value: CreateMarketScreenOptions) => {
      value.provenance.url = 'https://finviz.com/screener?token=private-key';
    },
    (value: CreateMarketScreenOptions) => {
      value.provenance.url = 'https://finviz.com.attacker.example/screener';
    },
    (value: CreateMarketScreenOptions) => {
      value.provenance.url = 'https://finviz.com/screener?f=cap_largeover';
    },
    (value: CreateMarketScreenOptions) => {
      value.provenance.filters = ['ind_stocksonly', 'cap_largeover'];
    },
    (value: CreateMarketScreenOptions) => {
      value.provenance.capturedAt = '2026-02-30T12:00:00Z';
    },
    (value: CreateMarketScreenOptions) => {
      value.provenance.capturedAt = new Date(Date.now() + 86_400_000).toISOString();
    },
    (value: CreateMarketScreenOptions) => {
      value.provenance.overallTotal = 1;
    },
    (value: CreateMarketScreenOptions) => {
      value.lookbackDays = 729;
    },
    (value: CreateMarketScreenOptions) => {
      value.lookbackDays = 3651;
    },
  ])('rejects inconsistent inputs before saving a job or starting network work', async (mutate) => {
    const options = input();
    mutate(options);

    await expect(createMarketScreenJob(options, deps())).rejects.toThrow(TypeError);
    expect(analyze).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it('validates IDs and paging and returns a typed safe not-found error', async () => {
    await expect(getMarketScreenJob('../secret', {}, deps())).rejects.toThrow(TypeError);
    await expect(getMarketScreenJob(randomUUID(), {}, deps())).rejects.toBeInstanceOf(
      MarketScreenJobNotFoundError
    );
    const created = await create(input(['ONE'], { autoStart: false }));
    await expect(getMarketScreenJob(created.job.id, { limit: 101 }, deps())).rejects.toThrow(
      TypeError
    );
    await expect(getMarketScreenJob(created.job.id, { offset: -1 }, deps())).rejects.toThrow(
      TypeError
    );
  });

  describe('terminal WhatsApp summaries', () => {
    const notificationFile = (id: string) => path.join(root, id, 'notification.json');

    it('skips report-provider work for an unconfigured completion sender', async () => {
      const builder = vi.fn<typeof buildStockReportWhatsAppNotification>(async () => {
        throw new Error('No report data should be requested');
      });
      const created = await createMarketScreenJob(input(['ONE'], { autoStart: false }), deps());
      ids.push(created.job.id);
      await runMarketScreenJob(created.job.id, {
        ...deps(),
        buildStockReportWhatsAppNotification: builder,
      });
      await settled(created.job.id);
      expect(builder).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledOnce();
    });

    it('enriches saved ranked rows only after the durable attempt using the job history window', async () => {
      const builder = vi.fn<typeof buildStockReportWhatsAppNotification>(async (input) => {
        const id = ids[0];
        expect(JSON.parse(await readFile(notificationFile(id), 'utf8'))).toMatchObject({
          result: null,
          finishedAt: null,
        });
        expect(await readMarketScreenLease(root)).toMatchObject({ jobId: id });
        expect(input.lookbackDays).toBe(2920);
        expect(input.candidates).toEqual([
          expect.objectContaining({
            ticker: 'ONE',
            decision: 'BUY',
            dataAsOf: '2026-01-02',
            gateReasons: expect.any(Array),
            reference: expect.objectContaining({
              price: expect.any(Number),
              stopLoss: expect.any(Number),
            }),
          }),
        ]);
        return {
          title: input.title,
          asOf: input.asOf,
          summary: 'Observed wins 6/10; reasons; analyst targets',
        };
      });
      const created = await createMarketScreenJob(
        input(['ONE'], { lookbackDays: 2920, autoStart: false }),
        deps()
      );
      ids.push(created.job.id);
      await runMarketScreenJob(created.job.id, {
        ...deps(),
        isWhatsAppNotificationConfigured: async () => true,
        buildStockReportWhatsAppNotification: builder,
      });
      await settled(created.job.id);
      expect(builder).toHaveBeenCalledOnce();
      expect(notify).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ summary: 'Observed wins 6/10; reasons; analyst targets' })
      );
    });

    it('keeps a terminal job and durable no-retry attempt when report enrichment fails', async () => {
      const builder = vi
        .fn<typeof buildStockReportWhatsAppNotification>()
        .mockRejectedValue(new Error('report source unavailable'));
      const created = await createMarketScreenJob(input(['ONE'], { autoStart: false }), deps());
      ids.push(created.job.id);
      await runMarketScreenJob(created.job.id, {
        ...deps(),
        isWhatsAppNotificationConfigured: async () => true,
        buildStockReportWhatsAppNotification: builder,
      });
      const complete = await settled(created.job.id);
      expect(complete.job.status).toBe('completed');
      expect(notify).not.toHaveBeenCalled();
      expect(JSON.parse(await readFile(notificationFile(created.job.id), 'utf8'))).toMatchObject({
        result: { status: 'failed', reason: 'network-error' },
      });
      await runMarketScreenJob(created.job.id, {
        ...deps(),
        isWhatsAppNotificationConfigured: async () => true,
        buildStockReportWhatsAppNotification: builder,
      });
      expect(builder).toHaveBeenCalledOnce();
    });

    it('sends one bounded ranked summary after results, terminal state and attempt are durable', async () => {
      analyze.mockImplementation(async (ticker) => {
        if (ticker === 'ERROR') return null;
        if (ticker === 'BLOCKED') return context(ticker, 'HOLD', 399);
        const index = Number(ticker.slice(1));
        const value = context(ticker, 'BUY', 250 + index * 10);
        value.result.close = 100 + index;
        return value;
      });
      notify.mockImplementation(async (message) => {
        const directories = await readdir(root);
        const id = directories.find((entry) => /^[a-f0-9-]{36}$/.test(entry));
        if (!id) throw new Error('Missing test job');
        const state = JSON.parse(await readFile(path.join(root, id, 'state.json'), 'utf8'));
        const attempt = JSON.parse(await readFile(notificationFile(id), 'utf8'));
        expect(state).toMatchObject({ status: 'partial', progress: { pending: 0, inFlight: 0 } });
        expect(message.asOf).toBe(
          `검색 완료 ${state.finishedAt.slice(0, 16).replace('T', ' ')} UTC`
        );
        expect(attempt).toMatchObject({ schemaVersion: 1, jobStatus: 'partial', result: null });
        expect(attempt.finishedAt).toBeNull();
        expect(await readMarketScreenLease(root)).toMatchObject({ jobId: id });
        const rowCount = (
          await Promise.all(
            ['matches', 'excluded', 'unavailable'].map((kind) =>
              readdir(path.join(root, id, 'results', kind))
            )
          )
        ).flat().length;
        expect(rowCount).toBe(8);
        return { status: 'accepted', messageId: 'wamid.fixture' };
      });
      const started = await create(input(['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'BLOCKED', 'ERROR']));
      const complete = await settled(started.job.id);

      expect(notify).toHaveBeenCalledOnce();
      const message = notify.mock.calls[0][0];
      expect(message.title).toContain('일부 누락');
      expect(complete.job.progress).toMatchObject({
        total: 8,
        analyzed: 7,
        matched: 6,
        excluded: 1,
        unavailable: 1,
      });
      expect(message.summary).not.toMatch(/필터|분석|알림|해석 주의|결과 범위|승률/);
      expect(message.summary).toContain('P5 BUY · 참고 105.00 · BUY 점수 300.0');
      expect(message.summary.indexOf('P5 BUY')).toBeLessThan(message.summary.indexOf('P4 BUY'));
      expect(message.summary.indexOf('P4 BUY')).toBeLessThan(message.summary.indexOf('P3 BUY'));
      expect(message.summary).not.toContain('P2 BUY');
      expect(message.summary).not.toContain('BLOCKED');
      expect(message.summary.length).toBeLessThanOrEqual(700);
      expect(JSON.parse(await readFile(notificationFile(started.job.id), 'utf8'))).toMatchObject({
        jobStatus: 'partial',
        result: { status: 'accepted', messageId: 'wamid.fixture' },
        finishedAt: expect.any(String),
      });
      expect(analyze).toHaveBeenCalledTimes(8);
    });

    it('uses final SELL decisions and SELL ranking with unavailable reference prices preserved', async () => {
      const scores: Record<string, number> = { LOW: 10, BEST: 300, MID: 200 };
      analyze.mockImplementation(async (ticker) => {
        const value = context(ticker, 'SELL', 500 - scores[ticker], scores[ticker]);
        if (ticker === 'BEST') value.result.atr = Number.NaN;
        return value;
      });
      const started = await create(input(['LOW', 'BEST', 'MID'], { decision: 'SELL' }));
      await settled(started.job.id);

      expect(notify).toHaveBeenCalledOnce();
      const summary = notify.mock.calls[0][0].summary;
      expect(summary).toContain('BEST SELL · 참고 자료 없음 · SELL 점수 300.0');
      expect(summary.indexOf('BEST SELL')).toBeLessThan(summary.indexOf('MID SELL'));
      expect(summary.indexOf('MID SELL')).toBeLessThan(summary.indexOf('LOW SELL'));
    });

    it('sends a completed zero-match summary and distinguishes excluded HOLDs from failures', async () => {
      analyze.mockImplementation(async (ticker) => context(ticker, 'HOLD'));
      const started = await create();
      const complete = await settled(started.job.id);

      expect(notify).toHaveBeenCalledOnce();
      const message = notify.mock.calls[0][0];
      expect(message.title).toContain('완료');
      expect(complete.job.progress).toMatchObject({
        total: 2,
        analyzed: 2,
        matched: 0,
        excluded: 2,
        unavailable: 0,
      });
      expect(message.summary).toBe('일치 종목 없음.');
    });

    it('explicitly identifies unavailable runs and partial Finviz collection', async () => {
      analyze.mockResolvedValue(null);
      const unavailable = await create();
      const unavailableSnapshot = await settled(unavailable.job.id);
      expect(notify.mock.calls[0][0].title).toContain('자료 없음');
      expect(unavailableSnapshot.job.progress).toMatchObject({
        total: 2,
        analyzed: 0,
        matched: 0,
        excluded: 0,
        unavailable: 2,
      });
      expect(notify.mock.calls[0][0].summary).toBe('일치 종목 없음.');

      analyze.mockImplementation(async (ticker) => context(ticker));
      const options = input();
      options.provenance = { ...options.provenance, sourceTotal: 1669, completeness: 'partial' };
      const partial = await create(options);
      const partialSnapshot = await settled(partial.job.id);
      expect(notify.mock.calls[1][0].title).toContain('일부 누락');
      expect(partialSnapshot.job.universe).toMatchObject({
        collectedCount: 2,
        sourceTotal: 1669,
        completeness: 'partial',
      });
      expect(notify.mock.calls[1][0].summary).not.toMatch(/Finviz|수집|결과 범위|해석 주의/);
    });

    it.each([
      { status: 'accepted', messageId: 'wamid.fixture' },
      { status: 'disabled', reason: 'not-configured' },
      { status: 'disabled', reason: 'invalid-configuration' },
      { status: 'failed', reason: 'http-error', httpStatus: 503 },
      { status: 'failed', reason: 'network-error' },
    ] as const)(
      'records %j without changing completion or resending on reads and resume',
      async (outcome) => {
        notify.mockResolvedValue(outcome);
        const started = await create(input(['ONE']));
        const complete = await settled(started.job.id);
        expect(complete.job.status).toBe('completed');
        expect(JSON.parse(await readFile(notificationFile(started.job.id), 'utf8')).result).toEqual(
          outcome
        );
        await Promise.all([
          runMarketScreenJob(started.job.id, deps()),
          pauseMarketScreenJob(started.job.id, deps()),
          getMarketScreenJob(started.job.id, {}, deps()),
          listMarketScreenJobs({}, deps()),
        ]);
        expect(notify).toHaveBeenCalledOnce();
        expect(analyze).toHaveBeenCalledOnce();
      }
    );

    it('sanitizes a thrown timeout or sender error without pausing the saved completion', async () => {
      notify.mockRejectedValue(new Error('AbortError private-token private-phone'));
      const started = await create(input(['ONE']));
      const complete = await settled(started.job.id);
      const artifact = await readFile(notificationFile(started.job.id), 'utf8');

      expect(complete.job.status).toBe('completed');
      expect(JSON.parse(artifact).result).toEqual({ status: 'failed', reason: 'network-error' });
      expect(artifact).not.toContain('private-token');
      expect(artifact).not.toContain('private-phone');
      await runMarketScreenJob(started.job.id, deps());
      expect(notify).toHaveBeenCalledOnce();
    });

    it('does not send if its durable attempt cannot be saved', async () => {
      storeHooks.beforeWrite = async (file) => {
        if (file.endsWith('/notification.json'))
          throw new Error('Notification storage unavailable');
      };
      const started = await create(input(['ONE']));
      const complete = await settled(started.job.id);

      expect(complete.job.status).toBe('completed');
      expect(notify).not.toHaveBeenCalled();
      await runMarketScreenJob(started.job.id, deps());
      expect(notify).not.toHaveBeenCalled();
    });

    it('retains the attempt when saving the sender result fails without retrying', async () => {
      storeHooks.beforeWrite = async (file, value) => {
        if (file.endsWith('/notification.json') && (value as { finishedAt: unknown }).finishedAt)
          throw new Error('Notification outcome storage unavailable');
      };
      notify.mockResolvedValue({ status: 'accepted', messageId: 'wamid.fixture' });
      const started = await create(input(['ONE']));
      const complete = await settled(started.job.id);

      expect(complete.job.status).toBe('completed');
      expect(JSON.parse(await readFile(notificationFile(started.job.id), 'utf8'))).toMatchObject({
        finishedAt: null,
        result: null,
      });
      await runMarketScreenJob(started.job.id, deps());
      expect(notify).toHaveBeenCalledOnce();
    });

    it('does not send before a terminal checkpoint is successfully saved', async () => {
      storeHooks.beforeWrite = async (file, value) => {
        if (file.endsWith('/state.json') && (value as { status: string }).status === 'completed')
          throw new Error('Final checkpoint unavailable');
      };
      const started = await create(input(['ONE']));
      await waitUntil(async () => (await readMarketScreenLease(root)) === null);

      expect((await getMarketScreenJob(started.job.id, {}, deps())).job.status).toBe('paused');
      expect(notify).not.toHaveBeenCalled();
      expect(await readdir(path.join(root, started.job.id))).not.toContain('notification.json');
    });

    it('suppresses a persisted attempt recovered before final completion', async () => {
      const started = await create(input(['ONE'], { autoStart: false }));
      await writeMarketScreenJson(notificationFile(started.job.id), {
        schemaVersion: 1,
        jobStatus: 'completed',
        attemptedAt: new Date().toISOString(),
        finishedAt: null,
        result: null,
      });
      await runMarketScreenJob(started.job.id, deps());
      expect((await settled(started.job.id)).job.status).toBe('completed');
      expect(notify).not.toHaveBeenCalled();
    });

    it('never sends while paused or pending and sends once after resume completes', async () => {
      const block = blocked();
      analyze.mockImplementation(async (ticker) => {
        await block.gate;
        return context(ticker);
      });
      const started = await create(input(['ONE', 'TWO', 'THREE', 'FOUR']));
      await waitUntil(() => analyze.mock.calls.length === 2);
      expect(notify).not.toHaveBeenCalled();
      await pauseMarketScreenJob(started.job.id, deps());
      block.release();
      await waitUntil(async () => (await readMarketScreenLease(root)) === null);
      const paused = await getMarketScreenJob(started.job.id, {}, deps());
      expect(paused.job.status).toBe('paused');
      expect(paused.job.progress.pending).toBe(2);
      expect(notify).not.toHaveBeenCalled();

      await runMarketScreenJob(started.job.id, deps());
      await settled(started.job.id);
      expect(notify).toHaveBeenCalledOnce();
    });

    it('holds the job lease through the notification while terminal reads and resumes stay read-only', async () => {
      const block = blocked();
      notify.mockImplementationOnce(async () => {
        await block.gate;
        return { status: 'accepted', messageId: 'wamid.fixture' };
      });
      const started = await create(input(['ONE']));
      await waitUntil(() => notify.mock.calls.length === 1);
      expect((await getMarketScreenJob(started.job.id, {}, deps())).job.status).toBe('completed');
      expect(await readMarketScreenLease(root)).toMatchObject({ jobId: started.job.id });
      await runMarketScreenJob(started.job.id, deps());
      const other = await create(input(['OTHER']));
      expect(other.job.status).toBe('paused');
      expect(analyze).toHaveBeenCalledOnce();
      expect(notify).toHaveBeenCalledOnce();

      block.release();
      await settled(started.job.id);
      await runMarketScreenJob(other.job.id, deps());
      await settled(other.job.id);
      expect(notify).toHaveBeenCalledTimes(2);
    });
  });

  describe('read-only job listing', () => {
    it('returns an empty page without creating a missing store', async () => {
      const directory = path.join(root, 'not-created');
      expect(await listMarketScreenJobs({}, { ...deps(), rootDirectory: directory })).toEqual({
        jobs: [],
        offset: 0,
        limit: 20,
        total: 0,
        hasMore: false,
      });
      expect(await readdir(root)).toEqual([]);
      expect(analyze).not.toHaveBeenCalled();
    });

    it('paginates by creation date descending and UUID ascending on ties', async () => {
      const jobs = await Promise.all(
        Array.from({ length: 4 }, () => create(input(['ONE'], { autoStart: false })))
      );
      const createdAt = [
        '2026-02-01T00:00:00.000Z',
        '2026-03-01T00:00:00.000Z',
        '2026-03-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      ];
      for (const [index, job] of jobs.entries())
        await writeMarketScreenJson(path.join(root, job.job.id, 'state.json'), {
          ...job.job,
          createdAt: createdAt[index],
        });

      const first = await listMarketScreenJobs({ limit: 2 }, deps());
      const second = await listMarketScreenJobs({ offset: 2, limit: 2 }, deps());
      const beyond = await listMarketScreenJobs({ offset: 10 }, deps());
      expect(first.jobs.map((job) => job.id)).toEqual([jobs[1].job.id, jobs[2].job.id].sort());
      expect(second.jobs.map((job) => job.id)).toEqual([jobs[0].job.id, jobs[3].job.id]);
      expect(first).toMatchObject({ offset: 0, limit: 2, total: 4, hasMore: true });
      expect(second).toMatchObject({ offset: 2, limit: 2, total: 4, hasMore: false });
      expect(beyond).toMatchObject({ jobs: [], offset: 10, limit: 20, total: 4, hasMore: false });
      expect(analyze).not.toHaveBeenCalled();
    });

    it('ignores unrelated paths, UUID files and uncommitted UUID directories', async () => {
      const created = await create(input(['ONE'], { autoStart: false }));
      await mkdir(path.join(root, 'not-a-job'));
      await mkdir(path.join(root, `.runner-stale-${randomUUID()}`));
      await mkdir(path.join(root, randomUUID()));
      await writeFile(path.join(root, randomUUID()), 'not a directory');
      await writeFile(path.join(root, 'not-a-job', 'state.json'), 'private unrelated content');
      await symlink(path.join(root, 'not-a-job'), path.join(root, randomUUID()));

      const listed = await listMarketScreenJobs({}, deps());
      expect(listed.total).toBe(1);
      expect(listed.jobs.map((job) => job.id)).toEqual([created.job.id]);
    });

    it('uses existing recovered progress semantics without mutating state, control or stale leases', async () => {
      const created = await create(input(['ONE', 'TWO'], { autoStart: false }));
      const id = created.job.id;
      await writeMarketScreenJson(path.join(root, id, 'results/matches/00000000.json'), {
        index: 0,
        kind: 'matches',
        completedAt: new Date().toISOString(),
        item: projectMatch('ONE', context('ONE')),
      });
      await writeMarketScreenJson(path.join(root, id, 'state.json'), {
        ...created.job,
        status: 'running',
        progress: { ...created.job.progress, pending: 0, inFlight: 2 },
      });
      await writeMarketScreenJson(path.join(root, id, 'control.json'), {
        desiredStatus: 'running',
        reason: null,
      });
      await writeMarketScreenJson(path.join(root, '.runner.lock', 'owner.json'), {
        pid: 2_147_483_647,
        token: randomUUID(),
        jobId: id,
        createdAt: new Date().toISOString(),
      });
      const files = [
        path.join(root, id, 'state.json'),
        path.join(root, id, 'control.json'),
        path.join(root, '.runner.lock', 'owner.json'),
      ];
      const before = await Promise.all(files.map((file) => readFile(file, 'utf8')));

      const listed = await listMarketScreenJobs({}, deps());
      expect(listed.jobs[0]).toMatchObject({
        status: 'paused',
        pauseReason: 'No worker is active; resume to continue pending candidates.',
        progress: { analyzed: 1, matched: 1, unavailable: 0, inFlight: 0, pending: 1 },
      });
      expect(await Promise.all(files.map((file) => readFile(file, 'utf8')))).toEqual(before);
      expect(analyze).not.toHaveBeenCalled();
      await rm(path.join(root, '.runner.lock'), { recursive: true });
    });

    it('reads result directory counts only for the chosen page and never parses result rows', async () => {
      const older = await create(input(['ONE'], { autoStart: false }));
      const newer = await create(input(['TWO'], { autoStart: false }));
      await writeMarketScreenJson(path.join(root, older.job.id, 'state.json'), {
        ...older.job,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      await rm(path.join(root, older.job.id, 'results'), { recursive: true });
      await writeFile(
        path.join(root, newer.job.id, 'results/matches/00000000.json'),
        'Result JSON is intentionally unreadable; listing should not open it.'
      );
      const readFiles: string[] = [];
      storeHooks.beforeRead = async (file) => {
        readFiles.push(file);
      };

      const listed = await listMarketScreenJobs({ limit: 1 }, deps());
      expect(listed).toMatchObject({ total: 2, hasMore: true });
      expect(listed.jobs[0]).toMatchObject({ id: newer.job.id, progress: { matched: 1 } });
      expect(readFiles.some((file) => file.includes('/results/'))).toBe(false);
      expect(readFiles).not.toContain(path.join(root, older.job.id, 'manifest.json'));
      expect(readFiles).not.toContain(path.join(root, older.job.id, 'control.json'));
    });

    it('omits a job deleted during selected-page loading and fills the page with the next job', async () => {
      const older = await create(input(['ONE'], { autoStart: false }));
      const newer = await create(input(['TWO'], { autoStart: false }));
      await writeMarketScreenJson(path.join(root, older.job.id, 'state.json'), {
        ...older.job,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      let deleted = false;
      storeHooks.beforeRead = async (file) => {
        if (file === path.join(root, newer.job.id, 'manifest.json') && !deleted) {
          deleted = true;
          await rm(path.join(root, newer.job.id), { recursive: true });
        }
      };

      const listed = await listMarketScreenJobs({ limit: 1 }, deps());
      expect(deleted).toBe(true);
      expect(listed.jobs.map((job) => job.id)).toEqual([older.job.id]);
      expect(listed).toMatchObject({ total: 1, hasMore: false });
    });

    it('fails clearly on corrupt saved jobs rather than silently hiding them or exposing paths', async () => {
      const created = await create(input(['ONE'], { autoStart: false }));
      await writeFile(
        path.join(root, created.job.id, 'state.json'),
        'private fixture invalid JSON'
      );
      await expect(listMarketScreenJobs({}, deps())).rejects.toThrow(
        'Saved market-screen jobs could not be listed.'
      );
      expect(analyze).not.toHaveBeenCalled();
    });

    it.each([{ offset: -1 }, { offset: 1.5 }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }])(
      'validates pagination before filesystem work (%j)',
      async (options) => {
        const directory = path.join(root, 'not-created');
        await expect(
          listMarketScreenJobs(options, { ...deps(), rootDirectory: directory })
        ).rejects.toThrow(TypeError);
        expect(await readdir(root)).toEqual([]);
      }
    );
  });
});
