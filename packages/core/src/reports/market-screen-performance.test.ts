import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMarketScreenJob,
  getMarketScreenJob,
  getMarketScreenPerformance,
  MarketScreenJobNotFoundError,
  refreshMarketScreenPerformance,
  runMarketScreenJob,
} from '@/reports/market-screen';
import {
  type MarketScreenPerformanceCandle,
  registerMarketScreenRecommendation,
} from '@/reports/market-screen-performance';
import {
  acquireMarketScreenLease,
  readMarketScreenJson,
  readMarketScreenLease,
  writeMarketScreenJson,
} from '@/reports/market-screen-store';

vi.mock('@/utils/whatsapp', () => ({
  isWhatsAppNotificationConfigured: vi.fn().mockResolvedValue(false),
  sendWhatsAppNotification: vi
    .fn()
    .mockResolvedValue({ status: 'disabled', reason: 'not-configured' }),
}));

const SIGNAL = '2026-09-25';
const PUBLICATION = '2026-09-26T12:00:00.000Z';
const SESSIONS = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
const DONE = '2026-10-05T12:00:00.000Z';
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 3));
function candles(exit = 102, entry = 100): MarketScreenPerformanceCandle[] {
  return SESSIONS.map((date, index) => ({
    date: new Date(`${date}T00:00:00.000Z`),
    open: entry,
    high: Math.max(entry, exit) + 5,
    low: Math.min(entry, exit) - 5,
    close: index === 4 ? exit : entry,
    volume: 1000,
  }));
}
async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    if (await check()) return;
    await pause();
  }
  throw new Error('Background fixture did not settle');
}

describe('frozen forward paper recommendation registration', () => {
  it('uses the next actual holiday-aware session and exactly five sessions', () => {
    expect(
      registerMarketScreenRecommendation('2026-01-16', '2026-01-17T01:00:00Z').sessions
    ).toEqual(['2026-01-20', '2026-01-21', '2026-01-22', '2026-01-23', '2026-01-26']);
    expect(
      registerMarketScreenRecommendation('2026-04-02', '2026-04-02T21:00:00Z').sessions[0]
    ).toBe('2026-04-06');
    expect(
      registerMarketScreenRecommendation('2027-12-30', '2027-12-30T22:00:00Z').sessions[0]
    ).toBe('2027-12-31');
  });
  it('uses America/New_York open including DST and rejects the exact open', () => {
    expect(
      registerMarketScreenRecommendation('2026-03-06', '2026-03-09T13:29:59.999Z').status
    ).toBe('pending');
    expect(registerMarketScreenRecommendation('2026-03-06', '2026-03-09T13:30:00Z').status).toBe(
      'ineligible'
    );
    expect(registerMarketScreenRecommendation('2026-01-16', '2026-01-20T14:29:59Z').status).toBe(
      'pending'
    );
    expect(registerMarketScreenRecommendation('2026-01-16', '2026-01-20T14:30:00Z').status).toBe(
      'ineligible'
    );
  });
  it('requires a completed signal session, honors early closes, and never accepts local timestamps', () => {
    expect(registerMarketScreenRecommendation('2026-11-27', '2026-11-27T17:59:59Z').status).toBe(
      'ineligible'
    );
    expect(registerMarketScreenRecommendation('2026-11-27', '2026-11-27T18:00:00Z').status).toBe(
      'pending'
    );
    expect(registerMarketScreenRecommendation('2026-09-26', PUBLICATION).status).toBe('ineligible');
    expect(registerMarketScreenRecommendation(SIGNAL, '2026-09-25T12:00:00Z').status).toBe(
      'ineligible'
    );
    expect(registerMarketScreenRecommendation(SIGNAL, '2026-09-26T12:00:00').status).toBe(
      'unavailable'
    );
  });
  it('fails closed for unknown dates/calendars and copies the frozen policy', () => {
    for (const date of [null, '2026-02-30', '2025-12-31', '2029-01-02'])
      expect(registerMarketScreenRecommendation(date, PUBLICATION).status).toBe('unavailable');
    const unsupportedWindow = registerMarketScreenRecommendation(
      '2028-12-29',
      '2028-12-29T22:00:00Z'
    );
    expect(unsupportedWindow.status).toBe('unavailable');
    expect(unsupportedWindow.sessions).toEqual([]);
    const first = registerMarketScreenRecommendation(SIGNAL, PUBLICATION);
    first.policy.costBpsRoundTrip = 10;
    expect(registerMarketScreenRecommendation(SIGNAL, PUBLICATION).policy).not.toBe(first.policy);
  });
});

describe('durable recommendation paper performance', () => {
  let root: string;
  let id: string;
  let time: string;
  let releases: Array<() => void>;
  let provider: ReturnType<
    typeof vi.fn<(ticker: string, days: number) => Promise<MarketScreenPerformanceCandle[]>>
  >;
  const deps = () => ({
    rootDirectory: root,
    now: () => new Date(time),
    fetchPrices: provider,
    minIntervalMs: 0,
  });

  async function seed(
    index: number,
    options: { legacy?: boolean; publication?: string; decision?: string; kind?: string } = {}
  ) {
    const kind = options.kind ?? 'matches';
    const completedAt = options.publication ?? PUBLICATION;
    const saved = {
      index,
      kind,
      completedAt,
      item: { ticker: `T${index}`, decision: options.decision ?? 'BUY', dataAsOf: SIGNAL },
      ...(options.legacy
        ? {}
        : { forwardPerformance: registerMarketScreenRecommendation(SIGNAL, completedAt) }),
    };
    await writeMarketScreenJson(
      path.join(root, id, `results/${kind}/${String(index).padStart(8, '0')}.json`),
      saved
    );
  }
  async function settled() {
    await waitUntil(async () => (await readMarketScreenLease(root)) === null);
    return getMarketScreenPerformance(id, {}, deps());
  }
  function block() {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    releases.push(release);
    return { release, promise };
  }
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'stock-forward-paper-')));
    time = DONE;
    releases = [];
    provider = vi.fn(async () => candles());
    const result = await createMarketScreenJob(
      {
        tickers: Array.from({ length: 12 }, (_, i) => `T${i}`),
        autoStart: false,
        provenance: {
          source: 'Finviz',
          url: 'https://finviz.com/screener?f=ind_stocksonly',
          filters: ['ind_stocksonly'],
          sourceTotal: 12,
          capturedAt: PUBLICATION,
          completeness: 'complete',
        },
      },
      { rootDirectory: root, minIntervalMs: 0 }
    );
    id = result.job.id;
  });
  afterEach(async () => {
    for (const release of releases) release();
    await waitUntil(async () => (await readMarketScreenLease(root)) === null);
    await rm(root, { recursive: true, force: true });
  });

  it('cached GET never calls providers, mutates rows, or retroactively tracks legacy BUYs', async () => {
    await seed(0, { legacy: true });
    await seed(1);
    await seed(2, { publication: '2026-09-28T13:30:00Z' });
    await seed(3, { decision: 'HOLD' });
    await seed(4, { kind: 'excluded' });
    const before = await readFile(path.join(root, id, 'results/matches/00000001.json'), 'utf8');
    const result = await getMarketScreenPerformance(id, {}, deps());
    expect(result.summary).toMatchObject({
      totalRecommendations: 3,
      legacyUntracked: 1,
      pending: 1,
      ineligible: 1,
      completed: 0,
      wins: 0,
      losses: 0,
      winRatePct: null,
      averageNetReturnPct: null,
    });
    expect(result.page.items[0]).toMatchObject({
      status: 'legacy-untracked',
      recommendedAt: null,
      outcome: null,
    });
    expect(provider).not.toHaveBeenCalled();
    expect(await readFile(path.join(root, id, 'results/matches/00000001.json'), 'utf8')).toBe(
      before
    );
  });

  it('validates IDs/page/refresh bounds before providers and returns the typed not-found error', async () => {
    await expect(getMarketScreenPerformance('../outside', {}, deps())).rejects.toThrow(TypeError);
    await expect(getMarketScreenPerformance(id, { offset: -1 }, deps())).rejects.toThrow(TypeError);
    await expect(getMarketScreenPerformance(id, { limit: 101 }, deps())).rejects.toThrow(TypeError);
    await expect(refreshMarketScreenPerformance(id, { limit: 51 }, deps())).rejects.toThrow(
      TypeError
    );
    await expect(
      getMarketScreenPerformance('00000000-0000-0000-0000-000000000000', {}, deps())
    ).rejects.toBeInstanceOf(MarketScreenJobNotFoundError);
    expect(provider).not.toHaveBeenCalled();
  });

  it('settles exact fifth session closes, 10bps round-trip costs, and all three outcomes', async () => {
    for (let i = 0; i < 3; i++) await seed(i);
    provider.mockImplementation(async (ticker) =>
      candles(ticker === 'T0' ? 102 : ticker === 'T1' ? 99 : 100.1)
    );
    await refreshMarketScreenPerformance(id, {}, deps());
    const result = await settled();
    expect(result.summary).toMatchObject({
      totalRecommendations: 3,
      completed: 3,
      wins: 1,
      losses: 1,
      breakeven: 1,
      pending: 0,
      unavailable: 0,
    });
    expect(result.summary.winRatePct).toBeCloseTo(100 / 3, 10);
    expect(result.summary.averageNetReturnPct).toBeCloseTo((1.9 - 1.1) / 3, 10);
    expect(result.page.items[0]).toMatchObject({
      entryDate: SESSIONS[0],
      exitDate: SESSIONS[4],
      entryPrice: 100,
      exitPrice: 102,
      outcome: 'win',
      status: 'completed',
    });
    expect(result.page.items[0]?.netReturnPct).toBeCloseTo(1.9, 10);
    expect(result.page.items[2]?.netReturnPct).toBe(0);
    expect(provider.mock.calls.map((call) => call[0])).toEqual(['SPY', 'T0', 'T1', 'T2']);
    expect(provider.mock.calls.every((call) => call[1] >= 30 && call[1] <= 3650)).toBe(true);
  });

  it('does not observe incomplete entry bars or finish before the fifth scheduled close', async () => {
    await seed(0);
    time = '2026-09-28T15:00:00Z';
    await refreshMarketScreenPerformance(id, {}, deps());
    let result = await settled();
    expect(result.page.items[0]).toMatchObject({
      status: 'open',
      entryPrice: null,
      outcome: null,
      netReturnPct: null,
    });
    time = '2026-10-02T19:59:59.999Z';
    await refreshMarketScreenPerformance(id, {}, deps());
    result = await settled();
    expect(result.page.items[0]).toMatchObject({
      status: 'open',
      entryPrice: 100,
      exitPrice: null,
      outcome: null,
    });
    time = '2026-10-02T20:00:00.000Z';
    await refreshMarketScreenPerformance(id, {}, deps());
    result = await settled();
    expect(result.page.items[0]?.status).toBe('completed');
  });

  it('keeps pre-open recommendations pending without provider calls', async () => {
    await seed(0);
    time = '2026-09-28T13:29:59Z';
    await refreshMarketScreenPerformance(id, {}, deps());
    const result = await settled();
    expect(result.page.items[0]?.status).toBe('pending');
    expect(result.summary.winRatePct).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(['SPY', 'T0'])(
    'missing %s session stays unavailable rather than moving the exit to a sixth bar',
    async (ticker) => {
      await seed(0);
      provider.mockImplementation(async (symbol) =>
        symbol === ticker
          ? [
              ...candles().filter((_, i) => i !== 1),
              { ...candles()[0], date: new Date('2026-10-05T00:00:00Z') },
            ]
          : candles()
      );
      await refreshMarketScreenPerformance(id, {}, deps());
      const result = await settled();
      expect(result.page.items[0]).toMatchObject({
        status: 'unavailable',
        exitDate: SESSIONS[4],
        outcome: null,
      });
      expect(result.summary).toMatchObject({ completed: 0, losses: 0, winRatePct: null });
    }
  );

  it.each(['invalid OHLC', 'duplicate', 'empty'])(
    'rejects %s instead of fabricating returns',
    async (mode) => {
      await seed(0);
      provider.mockImplementation(async (ticker) => {
        if (ticker === 'SPY') return candles();
        if (mode === 'duplicate') return [...candles(), candles()[0]];
        if (mode === 'empty') return [];
        return candles().map((bar, index) => (index === 2 ? { ...bar, low: 200 } : bar));
      });
      await refreshMarketScreenPerformance(id, {}, deps());
      expect((await settled()).summary).toMatchObject({ unavailable: 1, completed: 0, losses: 0 });
    }
  );

  it('refetches both prices on one adjusted scale, then never recalculates completed results', async () => {
    await seed(0);
    time = '2026-09-28T21:00:00Z';
    await refreshMarketScreenPerformance(id, {}, deps());
    expect((await settled()).page.items[0]?.entryPrice).toBe(100);
    time = DONE;
    provider.mockResolvedValue(candles(51, 50));
    await refreshMarketScreenPerformance(id, {}, deps());
    const completed = await settled();
    expect(completed.page.items[0]).toMatchObject({
      entryPrice: 50,
      exitPrice: 51,
      status: 'completed',
    });
    expect(completed.page.items[0]?.netReturnPct).toBeCloseTo(1.9, 10);
    const saved = await readFile(path.join(root, id, 'performance/00000000.json'), 'utf8');
    provider.mockClear();
    provider.mockRejectedValue(new Error('Do not request completed outcomes'));
    await refreshMarketScreenPerformance(id, {}, deps());
    const restarted = await settled();
    expect(restarted.page.items).toEqual(completed.page.items);
    expect(await readFile(path.join(root, id, 'performance/00000000.json'), 'utf8')).toBe(saved);
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects overflowing returns even if every input price is positive and finite', async () => {
    await seed(0);
    provider.mockImplementation(async (ticker) =>
      ticker === 'SPY'
        ? candles()
        : SESSIONS.map((date, i) => ({
            date: new Date(`${date}T00:00:00Z`),
            open: Number.MIN_VALUE,
            low: Number.MIN_VALUE,
            high: Number.MAX_VALUE,
            close: i === 4 ? Number.MAX_VALUE : Number.MIN_VALUE,
            volume: 1,
          }))
    );
    await refreshMarketScreenPerformance(id, {}, deps());
    expect((await settled()).page.items[0]).toMatchObject({
      status: 'unavailable',
      outcome: null,
      netReturnPct: null,
    });
  });

  it('makes retries fair and excludes provider failures from wins and losses', async () => {
    for (let i = 0; i < 3; i++) await seed(i);
    provider.mockImplementation(async (ticker) => {
      if (ticker === 'T0') throw new Error('429 private provider URL');
      return candles();
    });
    await refreshMarketScreenPerformance(id, { limit: 1 }, deps());
    expect((await settled()).summary).toMatchObject({ unavailable: 1, pending: 2, losses: 0 });
    await refreshMarketScreenPerformance(id, { limit: 1 }, deps());
    expect((await settled()).summary).toMatchObject({ unavailable: 1, completed: 1, pending: 1 });
    expect(provider.mock.calls.map((call) => call[0])).toEqual(['SPY', 'T0', 'SPY', 'T1']);
    provider.mockResolvedValue(candles());
    await refreshMarketScreenPerformance(id, {}, deps());
    expect((await settled()).summary).toMatchObject({ completed: 3, unavailable: 0, wins: 3 });
  });

  it('holds the shared lease through actual provider settlement and coalesces duplicate readers/refreshes', async () => {
    await seed(0);
    const blocked = block();
    provider.mockImplementation(async () => {
      await blocked.promise;
      return candles();
    });
    const started = await refreshMarketScreenPerformance(id, {}, deps());
    expect(started.refresh.status).toBe('running');
    expect((await readMarketScreenLease(root))?.purpose).toBe('forward-paper-performance');
    await Promise.all([
      getMarketScreenPerformance(id, {}, deps()),
      refreshMarketScreenPerformance(id, {}, deps()),
      refreshMarketScreenPerformance(id, {}, deps()),
    ]);
    expect(provider).toHaveBeenCalledTimes(1);
    const analyzer = vi.fn();
    const scan = await runMarketScreenJob(id, {
      rootDirectory: root,
      minIntervalMs: 0,
      analyzeTickerContext: analyzer,
    });
    expect(scan.job.status).toBe('paused');
    expect(scan.job.progress.inFlight).toBe(0);
    expect(analyzer).not.toHaveBeenCalled();
    blocked.release();
    expect((await settled()).summary.completed).toBe(1);
  });

  it('does not launch providers while any screen lease owns the shared budget', async () => {
    await seed(0);
    const lease = await acquireMarketScreenLease(root, id);
    const result = await refreshMarketScreenPerformance(id, {}, deps());
    expect(result.refresh).toMatchObject({ status: 'idle' });
    expect(result.refresh.reason).toContain('worker budget');
    expect(provider).not.toHaveBeenCalled();
    await lease.release();
  });

  it('preserves completed checkpoints and reports idle after a refresh owner dies', async () => {
    await seed(0);
    await refreshMarketScreenPerformance(id, {}, deps());
    await settled();
    const refreshFile = path.join(root, id, 'performance/refresh.json');
    const state = (await readMarketScreenJson(refreshFile)) as {
      token: string;
      processed: number;
      selected: number;
    };
    await writeMarketScreenJson(refreshFile, {
      ...state,
      selected: 3,
      processed: 1,
      updatedAt: DONE,
      reason: null,
    });
    provider.mockClear();
    const recovered = await getMarketScreenPerformance(id, {}, deps());
    expect(recovered.refresh.status).toBe('idle');
    expect(recovered.refresh.reason).toContain('previous refresh stopped');
    expect(recovered.summary.completed).toBe(1);
    expect(provider).not.toHaveBeenCalled();
  });

  it('releases an acquired lease if the initial refresh checkpoint cannot be saved', async () => {
    await seed(0);
    await mkdir(path.join(root, id, 'performance/refresh.json'), { recursive: true });
    await expect(refreshMarketScreenPerformance(id, {}, deps())).rejects.toThrow();
    expect(await readMarketScreenLease(root)).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  it('bounds repeated unavailable provider work and supports paged cached outcomes', async () => {
    for (let i = 0; i < 12; i++) await seed(i);
    provider.mockResolvedValue([]);
    await refreshMarketScreenPerformance(id, { limit: 12 }, deps());
    const result = await settled();
    expect(result.summary).toMatchObject({
      totalRecommendations: 12,
      unavailable: 5,
      pending: 7,
      completed: 0,
      losses: 0,
    });
    expect(result.refresh).toMatchObject({ selected: 12, processed: 5, status: 'idle' });
    expect(provider).toHaveBeenCalledTimes(1);
    const page = await getMarketScreenPerformance(id, { offset: 3, limit: 2 }, deps());
    expect(page.page).toMatchObject({ offset: 3, limit: 2, total: 12, hasMore: true });
    expect(page.page.items.map((row) => row.ticker)).toEqual(['T3', 'T4']);
    expect((await getMarketScreenJob(id, {}, { rootDirectory: root })).job.status).toBe('paused');
  });
});
