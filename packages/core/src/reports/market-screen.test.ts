import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import {
  type CreateMarketScreenOptions,
  createMarketScreenJob,
  getMarketScreenJob,
  MarketScreenJobNotFoundError,
  type MarketScreenJobSnapshot,
  pauseMarketScreenJob,
  runMarketScreenJob,
} from '@/reports/market-screen';
import { readMarketScreenLease, writeMarketScreenJson } from '@/reports/market-screen-store';
import { projectMatch } from '@/reports/stock-screen';
import type { analyzeTickerContext, TickerAnalysisContext } from '@/services/ticker-analysis';
import type { PipelineResult } from '@/types';

const storeHooks = vi.hoisted(() => ({
  beforeWrite: undefined as undefined | ((file: string, value: unknown) => Promise<void>),
}));

vi.mock('@/reports/market-screen-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/reports/market-screen-store')>();
  return {
    ...actual,
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
  let ids: string[];
  let releases: Array<() => void>;
  const deps = () => ({ rootDirectory: root, analyzeTickerContext: analyze, minIntervalMs: 0 });

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
    storeHooks.beforeWrite = undefined;
    root = await mkdtemp(path.join(os.tmpdir(), 'stock-checker-market-job-'));
    ids = [];
    releases = [];
    analyze = vi
      .fn<typeof analyzeTickerContext>()
      .mockImplementation(async (ticker) => context(ticker));
  });

  afterEach(async () => {
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
    const starts: number[] = [];
    analyze.mockImplementation(async (ticker) => {
      starts.push(Date.now());
      return context(ticker);
    });
    const started = await createMarketScreenJob(input(['ONE', 'TWO', 'THREE', 'FOUR']), {
      ...deps(),
      minIntervalMs: 50,
    });
    ids.push(started.job.id);
    await settled(started.job.id);

    expect(starts).toHaveLength(4);
    expect(starts[2] - Math.max(starts[0], starts[1])).toBeGreaterThanOrEqual(40);
    expect(starts[3] - Math.min(starts[0], starts[1])).toBeGreaterThanOrEqual(40);
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
});
