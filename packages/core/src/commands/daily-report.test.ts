import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type DailyReportDependencies,
  dailyReportSchedule,
  parseDailyReportArguments,
  priorRunCoveringSession,
  readDailyReportStatus,
  resolveDailyReportSource,
  runDailyReport,
  shouldLogDailyTick,
} from '@/commands/daily-report';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import { CONFIGURED_UNIVERSE_NAME } from '@/constants/tickers';
import type { FinvizCollectionResult } from '@/reports/finviz-collector';
import {
  MARKET_SCREEN_LEASE_BUSY_REASONS,
  type MarketScreenDependencies,
  type MarketScreenJobSnapshot,
} from '@/reports/market-screen';
import type { StockScreenMatch } from '@/reports/stock-screen';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const morning = new Date('2026-10-06T22:00:00Z'); // Sydney October 7, 09:00 AEDT.
const SESSION = '2026-10-06'; // The NYSE session that closed before the Sydney morning.
const collection: FinvizCollectionResult = {
  status: 'partial',
  tickers: ['OII', 'AAPL'],
  provenance: {
    source: 'Finviz',
    url: 'https://finviz.com/screener?v=411&f=ind_stocksonly,ta_sma50_pb&o=-volume',
    filters: ['ind_stocksonly', 'ta_sma50_pb'],
    sourceTotal: 3916,
    capturedAt: '2026-10-06T22:00:01Z',
    completeness: 'partial',
    pages: 1,
    collectionReason: 'candidate-limit',
  },
  reason: 'candidate-limit',
};

function snapshot(status: 'running' | 'paused' | 'partial' = 'partial'): MarketScreenJobSnapshot {
  return {
    job: {
      schemaVersion: 1,
      id: 'e6dd2673-35f9-4947-9353-1c70a2f154ed',
      status,
      createdAt: morning.toISOString(),
      updatedAt: morning.toISOString(),
      startedAt: morning.toISOString(),
      finishedAt: status === 'partial' ? morning.toISOString() : null,
      pauseReason: status === 'paused' ? 'Another market-screen job is active.' : null,
      universe: {
        source: 'finviz-candidates',
        validated: false,
        url: collection.provenance?.url ?? '',
        filters: ['ind_stocksonly', 'ta_sma50_pb'],
        sourceTotal: 3916,
        collectedCount: 2,
        inputCount: 2,
        capturedAt: morning.toISOString(),
        completeness: 'partial',
        collectionReason: 'candidate-limit',
        overallTotal: null,
        pages: 1,
      },
      usSession: SESSION,
      criteria: {
        decision: 'BUY',
        lookbackDays: 730,
        engine: 'existing SC',
        concurrency: 2,
        minIntervalMs: 1000,
      },
      progress: {
        total: 2,
        analyzed: status === 'partial' ? 2 : 0,
        unavailable: 0,
        pending: status === 'partial' ? 0 : 2,
        inFlight: 0,
        matched: 0,
        excluded: status === 'partial' ? 2 : 0,
      },
      warnings: [],
    },
    page: { kind: 'matches', offset: 0, limit: 3, total: 0, hasMore: false, items: [] },
  };
}

async function fixture(
  environment: NodeJS.ProcessEnv = { DAILY_REPORT_SOURCE: 'finviz' }
): Promise<DailyReportDependencies & { rootDirectory: string }> {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), 'stock-checker-daily-'));
  roots.push(rootDirectory);
  return {
    rootDirectory,
    marketRootDirectory: path.join(rootDirectory, 'market'),
    environment,
    now: () => morning,
    isConfigured: vi.fn(async () => true),
    isBrowserAvailable: vi.fn(async () => true),
    collect: vi.fn(async () => structuredClone(collection)),
    configuredUniverse: () => ['OII', 'AAPL'],
    send: vi.fn(async () => ({ status: 'accepted' as const, messageId: 'offline-test-id' })),
    createJob: vi.fn(async () => snapshot('paused')),
    runJob: vi.fn(async (_id, dependencies) => {
      await dependencies?.sendWhatsAppNotification?.({
        title: '시장 후보 스크리닝 · BUY · 일부 누락',
        asOf: '검색 완료 2026-10-06 22:01 UTC',
        summary: 'OII BUY\n과거 BUY 20표본 · 승률 60%',
      });
      return snapshot();
    }),
    getJob: vi.fn(async () => snapshot()),
    pauseJob: vi.fn(async () => snapshot('paused')),
    hasJobNotificationAttempt: vi.fn(async () => false),
    pollIntervalMs: 1,
    leaseRetryMs: 1,
  };
}

describe('Sydney morning schedule', () => {
  it('uses Sydney DST rather than the host timezone and admits the primary window', () => {
    expect(dailyReportSchedule(morning)).toMatchObject({
      localDate: '2026-10-07',
      window: 'primary',
      eligible: true,
      timezone: 'Australia/Sydney',
      usSession: SESSION,
      nextSessionOpen: '2026-10-07',
    });
    expect(dailyReportSchedule(new Date('2026-07-07T23:14:59Z'))).toMatchObject({
      localDate: '2026-07-08',
      window: 'primary',
      eligible: true,
    });
    expect(dailyReportSchedule(new Date('2026-10-06T21:59:59Z'))).toMatchObject({
      window: null,
      eligible: false,
    });
  });

  it('allows a late catch-up run until 90 minutes before the next NYSE open, then closes', () => {
    // 09:15 AEST July 8: the next open (July 8, 13:30Z) is more than 90 minutes away.
    expect(dailyReportSchedule(new Date('2026-07-07T23:15:00Z'))).toMatchObject({
      localDate: '2026-07-08',
      window: 'late',
      eligible: true,
      lateUntil: '2026-07-08T12:00:00.000Z',
    });
    // 14:00 AEDT October 7 is a late run; 23:30 AEDT is inside the 90-minute cutoff.
    expect(dailyReportSchedule(new Date('2026-10-07T03:00:00Z'))).toMatchObject({
      window: 'late',
      eligible: true,
    });
    expect(dailyReportSchedule(new Date('2026-10-07T12:30:00Z'))).toMatchObject({
      localDate: '2026-10-07',
      window: null,
      eligible: false,
    });
    // Saturday catch-up stays open because the next open is Monday.
    expect(dailyReportSchedule(new Date('2026-10-10T05:00:00Z'))).toMatchObject({
      localDate: '2026-10-10',
      window: 'late',
      usSession: '2026-10-09',
      nextSessionOpen: '2026-10-12',
    });
    // Outside the verified calendar there is no catch-up window.
    expect(dailyReportSchedule(new Date('2031-10-07T03:00:00Z'))).toMatchObject({
      window: null,
      eligible: false,
      usSession: null,
    });
  });

  it('limits the CLI to explicit read-only status and dry-run modes', () => {
    expect(parseDailyReportArguments([])).toEqual('run');
    expect(parseDailyReportArguments(['--status'])).toEqual('status');
    expect(parseDailyReportArguments(['--dry-run'])).toEqual('dry-run');
    for (const arguments_ of [['--force'], ['--status', '--dry-run'], ['--dry-run', '--dry-run']]) {
      expect(() => parseDailyReportArguments(arguments_)).toThrow();
    }
  });

  it('defaults the universe source to the configured list and accepts the Finviz opt-in', () => {
    expect(resolveDailyReportSource({})).toBe('configured-universe');
    expect(resolveDailyReportSource({ DAILY_REPORT_SOURCE: 'configured' })).toBe(
      'configured-universe'
    );
    expect(resolveDailyReportSource({ DAILY_REPORT_SOURCE: 'finviz' })).toBe('finviz-candidates');
    expect(resolveDailyReportSource({ DAILY_REPORT_SOURCE: 'Finviz-Candidates' })).toBe(
      'finviz-candidates'
    );
    expect(() => resolveDailyReportSource({ DAILY_REPORT_SOURCE: 'yahoo' })).toThrow(
      /DAILY_REPORT_SOURCE/
    );
  });

  it('matches an earlier delivered scan only on the same known US session', () => {
    const delivered = {
      localDate: '2026-10-06',
      usSession: SESSION,
      status: 'partial' as const,
      notificationStatus: 'accepted' as const,
    };
    expect(priorRunCoveringSession([delivered], '2026-10-07', SESSION)).toBe('2026-10-06');
    expect(priorRunCoveringSession([delivered], '2026-10-06', SESSION)).toBeNull();
    expect(priorRunCoveringSession([delivered], '2026-10-07', '2026-10-07')).toBeNull();
    expect(priorRunCoveringSession([delivered], '2026-10-07', null)).toBeNull();
    expect(
      priorRunCoveringSession(
        [{ ...delivered, notificationStatus: 'failed' }],
        '2026-10-07',
        SESSION
      )
    ).toBeNull();
    expect(
      priorRunCoveringSession([{ ...delivered, status: 'unavailable' }], '2026-10-07', SESSION)
    ).toBeNull();
    expect(
      priorRunCoveringSession(
        [{ localDate: '2026-10-06', status: 'partial' }],
        '2026-10-07',
        SESSION
      )
    ).toBeNull();
  });
});

describe('daily screening dispatch', () => {
  it('dry-run and a cutoff-hour installation perform no collection, claims, market work or send', async () => {
    const dependencies = await fixture();
    expect(await runDailyReport({ dryRun: true }, dependencies)).toMatchObject({
      status: 'dry-run',
      eligible: true,
      source: 'finviz-candidates',
      maxCandidates: 200,
      browserReady: true,
    });
    expect(await readdir(dependencies.rootDirectory)).toEqual([]);
    expect(dependencies.isConfigured).not.toHaveBeenCalled();
    expect(
      await runDailyReport({}, { ...dependencies, now: () => new Date('2026-10-07T12:30:00Z') })
    ).toMatchObject({ status: 'skipped', reason: 'outside-window' });
    for (const operation of [dependencies.collect, dependencies.createJob, dependencies.send])
      expect(operation).not.toHaveBeenCalled();
  });

  it('dry-run for the configured default estimates the scan without probing a browser', async () => {
    const dependencies = await fixture({});
    dependencies.configuredUniverse = () => Array.from({ length: 555 }, (_, i) => `T${i}`);
    expect(await runDailyReport({ dryRun: true }, dependencies)).toMatchObject({
      status: 'dry-run',
      source: 'configured-universe',
      universeSize: 555,
      estimatedScanMs: 278 * 2_500,
      withinBudget: true,
      browserReady: null,
    });
    expect(dependencies.isBrowserAvailable).not.toHaveBeenCalled();
  });

  it('scans the configured validated universe by default without any Finviz collection', async () => {
    const dependencies = await fixture({});
    const saved = snapshot();
    saved.job.universe = {
      source: 'configured-universe',
      validated: true,
      name: CONFIGURED_UNIVERSE_NAME,
      url: null,
      filters: [],
      sourceTotal: 2,
      collectedCount: 2,
      inputCount: 2,
      capturedAt: morning.toISOString(),
      completeness: 'complete',
      overallTotal: null,
      pages: null,
      collectionReason: null,
    };
    saved.job.outcome = { collection: 'complete', analysis: 'complete' };
    const runJob = dependencies.runJob!;
    dependencies.runJob = vi.fn(async (...arguments_: Parameters<typeof runJob>) => {
      await runJob(...arguments_);
      return saved;
    });
    dependencies.getJob = vi.fn(async () => saved);
    dependencies.send = vi.fn(async (notification) => {
      expect(notification.title).toContain('검증 유니버스 2종목');
      expect(notification.title).toContain(`미국 세션 ${SESSION}`);
      expect(notification.title).not.toContain('Finviz');
      return { status: 'accepted' as const, messageId: 'offline-id' };
    });
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'partial',
      window: 'primary',
      usSession: SESSION,
      source: 'configured-universe',
      universeSource: 'configured-universe',
      collection: { status: 'complete', reason: null },
      collectedCount: 2,
      sourceTotal: 2,
      completeness: 'complete',
      estimatedScanMs: 2_500,
      analysisStatus: 'complete',
      notificationStatus: 'accepted',
    });
    expect(dependencies.collect).not.toHaveBeenCalled();
    expect(dependencies.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        tickers: ['OII', 'AAPL'],
        provenance: expect.objectContaining({
          source: 'configured-universe',
          name: CONFIGURED_UNIVERSE_NAME,
        }),
        usSession: SESSION,
        decision: 'BUY',
        lookbackDays: 730,
        autoStart: false,
      }),
      expect.anything()
    );
    expect(
      JSON.parse(
        await readFile(path.join(dependencies.rootDirectory, '2026-10-07.claim.json'), 'utf8')
      )
    ).toMatchObject({ localDate: '2026-10-07', usSession: SESSION, window: 'primary' });
  });

  it('claims the Sydney date before collection and the dispatch before sending, preserving actual partial provenance', async () => {
    const dependencies = await fixture();
    dependencies.collect = vi.fn(async () => {
      expect(
        JSON.parse(
          await readFile(path.join(dependencies.rootDirectory, '2026-10-07.claim.json'), 'utf8')
        )
      ).toMatchObject({ localDate: '2026-10-07' });
      return collection;
    });
    dependencies.send = vi.fn(async (notification) => {
      expect(
        await stat(path.join(dependencies.rootDirectory, '2026-10-07.dispatch.json'))
      ).toBeDefined();
      expect(notification.title).toContain('Finviz 후보 2/3916');
      expect(notification.title).toContain('평가 완료 2/2');
      expect(notification.title).toContain(`미국 세션 ${SESSION}`);
      expect(notification.title).not.toMatch(/누락|\(부분\)|자료 없음/);
      expect(notification.summary).toContain('과거 BUY 20표본');
      return { status: 'accepted' as const, messageId: 'offline-id' };
    });
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'partial',
      notificationStatus: 'accepted',
      source: 'finviz-candidates',
      universeSource: 'finviz-candidates',
      collection: { status: 'capped', reason: 'candidate-limit' },
      collectedCount: 2,
      sourceTotal: 3916,
    });
    expect(dependencies.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        tickers: ['OII', 'AAPL'],
        provenance: collection.provenance,
        usSession: SESSION,
        decision: 'BUY',
        lookbackDays: 730,
        autoStart: false,
      }),
      expect.anything()
    );
    expect(
      (await stat(path.join(dependencies.rootDirectory, '2026-10-07.claim.json'))).mode & 0o777
    ).toBe(0o600);
    expect((await stat(dependencies.rootDirectory)).mode & 0o777).toBe(0o700);
  });

  it('uses refreshed analysis failure counts without treating capped collection as missing data', async () => {
    const dependencies = await fixture();
    const current = snapshot();
    current.job.progress = { ...current.job.progress, analyzed: 1, unavailable: 1, excluded: 1 };
    dependencies.getJob = vi.fn(async () => current);
    const runJob = dependencies.runJob!;
    dependencies.runJob = vi.fn(async (...arguments_: Parameters<typeof runJob>) => {
      await runJob(...arguments_);
      return current;
    });
    dependencies.send = vi.fn(async (notification) => {
      expect(notification.title).toBe(
        `아침 스크리닝 · BUY 0개 · 평가 1/2 · 미산정 1종목 · Finviz 후보 2/3916 · 미국 세션 ${SESSION}`
      );
      expect(notification.title).not.toMatch(/일부 누락|자료 없음|\(부분\)/);
      return { status: 'accepted' as const, messageId: 'offline-id' };
    });

    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'partial',
      notificationStatus: 'accepted',
      analyzedCount: 1,
      analysisStatus: 'degraded',
      collection: { status: 'capped' },
    });
    expect(dependencies.send).toHaveBeenCalledOnce();
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'skipped',
      reason: 'already-claimed',
    });
    expect(dependencies.send).toHaveBeenCalledOnce();
  });

  it('skips a new local date whose US session was already delivered, without scanning or sending', async () => {
    const dependencies = await fixture({});
    await runDailyReport({}, dependencies);
    expect(dependencies.send).toHaveBeenCalledOnce();
    // Sunday morning after Friday's session repeats Saturday's US session.
    const saturday = new Date('2026-10-09T22:00:00Z'); // Sydney Sat Oct 10 09:00
    const sunday = new Date('2026-10-10T22:00:00Z'); // Sydney Sun Oct 11 09:00
    const first = await runDailyReport({}, { ...dependencies, now: () => saturday });
    expect(first).toMatchObject({ localDate: '2026-10-10', usSession: '2026-10-09' });
    const createJob = dependencies.createJob as ReturnType<typeof vi.fn>;
    const sends = (dependencies.send as ReturnType<typeof vi.fn>).mock.calls.length;
    const second = await runDailyReport({}, { ...dependencies, now: () => sunday });
    expect(second).toMatchObject({
      localDate: '2026-10-11',
      usSession: '2026-10-09',
      status: 'skipped',
      reason: 'no-new-session',
      coveredBy: '2026-10-10',
    });
    expect(createJob.mock.calls.length).toBe(2);
    expect((dependencies.send as ReturnType<typeof vi.fn>).mock.calls.length).toBe(sends);
    expect(
      JSON.parse(
        await readFile(path.join(dependencies.rootDirectory, '2026-10-11.state.json'), 'utf8')
      )
    ).toMatchObject({ status: 'skipped', reason: 'no-new-session', usSession: '2026-10-09' });
  });

  it('re-runs the same US session when the earlier run never delivered its scan', async () => {
    const dependencies = await fixture({});
    await writeFile(
      path.join(dependencies.rootDirectory, '2026-10-06.state.json'),
      JSON.stringify({
        schemaVersion: 2,
        localDate: '2026-10-06',
        usSession: SESSION,
        status: 'partial',
        notificationStatus: 'failed',
      })
    );
    expect(await runDailyReport({}, dependencies)).toMatchObject({ status: 'partial' });
    expect(dependencies.send).toHaveBeenCalledOnce();
  });

  it('labels a late catch-up run and still claims the local date once', async () => {
    const dependencies = await fixture({});
    const afternoon = new Date('2026-10-07T03:00:00Z'); // Sydney Oct 7, 14:00 AEDT.
    dependencies.now = () => afternoon;
    dependencies.send = vi.fn(async (notification) => {
      expect(notification.title).toMatch(/^아침 스크리닝 \(지연\) · /);
      return { status: 'accepted' as const, messageId: 'offline-id' };
    });
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'partial',
      window: 'late',
      localDate: '2026-10-07',
      usSession: SESSION,
    });
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'skipped',
      reason: 'already-claimed',
    });
    expect(dependencies.send).toHaveBeenCalledOnce();
  });

  it('waits briefly for a busy global lease instead of giving up the morning report', async () => {
    const dependencies = await fixture({});
    let elapsed = 0;
    dependencies.now = () => new Date(morning.getTime() + elapsed);
    dependencies.sleep = async (milliseconds) => {
      elapsed += milliseconds;
    };
    dependencies.leaseRetryMs = 1_000;
    const busy = snapshot('paused');
    busy.job.pauseReason = MARKET_SCREEN_LEASE_BUSY_REASONS.screen;
    const refresh = snapshot('paused');
    refresh.job.pauseReason = MARKET_SCREEN_LEASE_BUSY_REASONS.performance;
    const runJob = dependencies.runJob!;
    dependencies.runJob = vi
      .fn<typeof runJob>()
      .mockResolvedValueOnce(busy)
      .mockResolvedValueOnce(refresh)
      .mockImplementation(runJob);
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'partial',
      reason: null,
      notificationStatus: 'accepted',
    });
    expect(dependencies.runJob).toHaveBeenCalledTimes(3);
    expect(dependencies.pauseJob).not.toHaveBeenCalled();
    expect(elapsed).toBe(2_000);
  });

  it('gives up the lease wait at its deadline with one paused fallback', async () => {
    const dependencies = await fixture({});
    let elapsed = 0;
    dependencies.now = () => new Date(morning.getTime() + elapsed);
    dependencies.sleep = async (milliseconds) => {
      elapsed += milliseconds;
    };
    dependencies.leaseWaitMs = 3_000;
    dependencies.leaseRetryMs = 1_000;
    const busy = snapshot('paused');
    busy.job.pauseReason = MARKET_SCREEN_LEASE_BUSY_REASONS.screen;
    dependencies.runJob = vi.fn(async () => busy);
    dependencies.getJob = vi.fn(async () => busy);
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'paused',
      reason: 'job-paused',
      notificationStatus: 'accepted',
    });
    expect(dependencies.runJob).toHaveBeenCalledTimes(4);
    expect(dependencies.send).toHaveBeenCalledOnce();
  });

  it('concurrent ticks and restart cannot create a second scan or send for the same date', async () => {
    const dependencies = await fixture();
    const outputs = await Promise.all([
      runDailyReport({}, dependencies),
      runDailyReport({}, dependencies),
    ]);
    expect(outputs.filter((output) => output.status === 'skipped')).toHaveLength(1);
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'skipped',
      reason: 'already-claimed',
    });
    expect(dependencies.collect).toHaveBeenCalledTimes(1);
    expect(dependencies.send).toHaveBeenCalledTimes(1);
    expect(dependencies.createJob).toHaveBeenCalledTimes(1);
  });

  it('a prior crash claim prevents automatic retries without reading provider data', async () => {
    const dependencies = await fixture();
    await writeFile(path.join(dependencies.rootDirectory, '2026-10-07.claim.json'), '{}');
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'skipped',
      reason: 'already-claimed',
    });
    expect(dependencies.isConfigured).not.toHaveBeenCalled();
    expect(dependencies.collect).not.toHaveBeenCalled();
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it('a Finviz collection failure falls back to the configured universe and records why', async () => {
    const dependencies = await fixture();
    dependencies.collect = vi.fn(async () => ({
      status: 'unavailable' as const,
      tickers: [],
      provenance: null,
      reason: 'browser-unavailable' as const,
    }));
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'partial',
      reason: 'finviz-fallback',
      source: 'finviz-candidates',
      universeSource: 'configured-universe',
      collection: { status: 'unavailable', reason: 'browser-unavailable' },
      collectedCount: 2,
      sourceTotal: 2,
      notificationStatus: 'accepted',
    });
    expect(dependencies.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        tickers: ['OII', 'AAPL'],
        provenance: expect.objectContaining({ source: 'configured-universe' }),
      }),
      expect.anything()
    );
    expect(dependencies.send).toHaveBeenCalledTimes(1);
  });

  it('a verified empty Finviz source reports no match without creating an invalid empty job', async () => {
    const dependencies = await fixture();
    dependencies.collect = vi.fn(async () => ({
      status: 'available' as const,
      tickers: [],
      reason: null,
      provenance: { ...collection.provenance!, sourceTotal: 0, completeness: 'complete' as const },
    }));
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'completed',
      collectedCount: 0,
      sourceTotal: 0,
      universeSource: 'finviz-candidates',
    });
    expect(dependencies.createJob).not.toHaveBeenCalled();
    expect(dependencies.send).toHaveBeenCalledWith(
      expect.objectContaining({ summary: '일치 종목 없음.' })
    );
  });

  it('busy or paused jobs produce one fallback and never pause a different market job', async () => {
    const dependencies = await fixture();
    dependencies.runJob = vi.fn(async () => snapshot('paused'));
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'paused',
      notificationStatus: 'accepted',
    });
    expect(dependencies.pauseJob).not.toHaveBeenCalled();
    expect(dependencies.send).toHaveBeenCalledTimes(1);
  });

  it('a paused job claims dispatch before enriching saved BUYs and preserves the original reasons/date/reference', async () => {
    const dependencies = await fixture();
    const saved = snapshot('paused');
    saved.job.criteria.pipelineConfig = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    saved.job.criteria.pipelineConfig.thresholds.buy = 230;
    saved.job.progress.analyzed = 1;
    saved.job.progress.matched = 1;
    saved.page.items = [
      {
        ticker: 'OII',
        decision: 'BUY',
        dataAsOf: '2026-10-05',
        gateReasons: ['original signal reason'],
        execution: { reference: { price: 24, stopLoss: 22, takeProfit: 28, atr: 2 } },
      } as StockScreenMatch,
    ];
    dependencies.runJob = vi.fn(async () => saved);
    dependencies.getJob = vi.fn(async () => saved);
    dependencies.buildReport = vi.fn(async (input) => {
      expect(
        await stat(path.join(dependencies.rootDirectory, '2026-10-07.dispatch.json'))
      ).toBeDefined();
      expect(input).toMatchObject({
        lookbackDays: 730,
        pipelineConfig: saved.job.criteria.pipelineConfig,
        usSession: SESSION,
        universeSource: 'finviz-candidates',
        jobId: saved.job.id,
        candidates: [
          {
            ticker: 'OII',
            decision: 'BUY',
            dataAsOf: '2026-10-05',
            gateReasons: ['original signal reason'],
            reference: { price: 24, stopLoss: 22, takeProfit: 28 },
          },
        ],
      });
      return {
        title: input.title,
        asOf: input.asOf,
        summary: 'OII BUY · 과거 BUY 20표본 60% · 목표가 자료 없음',
      };
    });
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'paused',
      notificationStatus: 'accepted',
    });
    expect(dependencies.buildReport).toHaveBeenCalledTimes(1);
    expect(dependencies.send).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('평가 1/2'),
        summary: expect.stringContaining('20표본'),
      })
    );
  });

  it('a paused job with provider workers still running uses saved details without starting enrichment', async () => {
    const dependencies = await fixture();
    const saved = snapshot('paused');
    saved.job.progress.inFlight = 1;
    saved.job.progress.analyzed = 1;
    saved.page.items = [
      {
        ticker: 'OII',
        decision: 'BUY',
        dataAsOf: '2026-10-05',
        gateReasons: ['original signal reason'],
        execution: { reference: { price: 24, stopLoss: 22, takeProfit: 28, atr: 2 } },
      } as StockScreenMatch,
    ];
    dependencies.runJob = vi.fn(async () => saved);
    dependencies.getJob = vi.fn(async () => saved);
    dependencies.buildReport = vi.fn(async () => {
      throw new Error('must not overlap providers');
    });
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'paused',
      notificationStatus: 'accepted',
    });
    expect(dependencies.buildReport).not.toHaveBeenCalled();
    expect(dependencies.send).toHaveBeenCalledWith(
      expect.objectContaining({ summary: expect.stringContaining('OII') })
    );
  });

  it('execution deadline pauses only the owned job; a late completion cannot send a duplicate', async () => {
    const dependencies = await fixture();
    let elapsed = 0;
    let jobDependencies: MarketScreenDependencies | undefined;
    dependencies.now = () => new Date(morning.getTime() + elapsed);
    dependencies.sleep = async (milliseconds) => {
      elapsed += milliseconds;
    };
    dependencies.executionBudgetMs = 10;
    dependencies.pollIntervalMs = 5;
    dependencies.runJob = vi.fn(async (_id, passed) => {
      jobDependencies = passed;
      return snapshot('running');
    });
    dependencies.getJob = vi.fn(async () => snapshot('running'));
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'paused',
      reason: 'execution-deadline',
    });
    expect(dependencies.pauseJob).toHaveBeenCalledWith(snapshot().job.id, expect.anything());
    await jobDependencies?.sendWhatsAppNotification?.({
      title: 'late result',
      asOf: 'today',
      summary: 'late',
    });
    expect(dependencies.send).toHaveBeenCalledTimes(1);
  });

  it('a durable market notification attempt suppresses fallback even before sender completion', async () => {
    const dependencies = await fixture();
    dependencies.runJob = vi.fn(async () => snapshot('paused'));
    dependencies.hasJobNotificationAttempt = vi.fn(async () => true);
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'paused',
      reason: 'notification-already-attempted',
    });
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it('disabled configuration avoids collection and a failed send is never retried', async () => {
    const disabled = await fixture();
    disabled.isConfigured = vi.fn(async () => false);
    expect(await runDailyReport({}, disabled)).toMatchObject({
      status: 'disabled',
      notificationStatus: 'disabled',
    });
    expect(disabled.collect).not.toHaveBeenCalled();
    expect(disabled.send).not.toHaveBeenCalled();
    const failed = await fixture();
    failed.send = vi.fn(async () => {
      throw new Error('offline transport failure');
    });
    expect(await runDailyReport({}, failed)).toMatchObject({ notificationStatus: 'failed' });
    await runDailyReport({}, failed);
    expect(failed.send).toHaveBeenCalledTimes(1);
  });

  it('status reads saved dates/counts without provider calls or message bodies', async () => {
    const dependencies = await fixture();
    await runDailyReport({}, dependencies);
    expect(await readDailyReportStatus(dependencies)).toMatchObject({
      timezone: 'Australia/Sydney',
      lastRun: {
        localDate: '2026-10-07',
        window: 'primary',
        usSession: SESSION,
        status: 'partial',
        source: 'finviz-candidates',
        universeSource: 'finviz-candidates',
        collection: { status: 'capped', reason: 'candidate-limit' },
        notificationStatus: 'accepted',
        collectedCount: 2,
        sourceTotal: 3916,
      },
    });
    expect(dependencies.collect).toHaveBeenCalledTimes(1);
    // Legacy schemaVersion 1 states are readable with null session fields.
    await writeFile(
      path.join(dependencies.rootDirectory, '2026-10-08.state.json'),
      JSON.stringify({ schemaVersion: 1, localDate: '2026-10-08', status: 'completed' })
    );
    expect(await readDailyReportStatus(dependencies)).toMatchObject({
      lastRun: { localDate: '2026-10-08', usSession: null, universeSource: null },
    });
  });

  it('logs skipped ticks once per state change and every non-skipped result', async () => {
    const dependencies = await fixture();
    const outside = { status: 'skipped', reason: 'outside-window', localDate: '2026-10-07' };
    expect(await shouldLogDailyTick(outside, dependencies)).toBe(true);
    expect(await shouldLogDailyTick(outside, dependencies)).toBe(false);
    expect(await shouldLogDailyTick({ ...outside, reason: 'already-claimed' }, dependencies)).toBe(
      true
    );
    expect(await shouldLogDailyTick({ ...outside, localDate: '2026-10-08' }, dependencies)).toBe(
      true
    );
    expect(await shouldLogDailyTick({ status: 'partial' }, dependencies)).toBe(true);
    expect(await shouldLogDailyTick({ status: 'partial' }, dependencies)).toBe(true);
    expect(
      (await stat(path.join(dependencies.rootDirectory, '.last-tick.json'))).mode & 0o777
    ).toBe(0o600);
  });

  it('uses the existing dashboard/MCP market store by default, preserving its shared global lease', async () => {
    const dependencies = await fixture();
    delete dependencies.marketRootDirectory;
    await runDailyReport({}, dependencies);
    expect(dependencies.createJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        rootDirectory: path.resolve(import.meta.dirname, '../../../../data/market-scans'),
      })
    );
    expect(dependencies.runJob).toHaveBeenCalledWith(
      snapshot().job.id,
      expect.objectContaining({
        rootDirectory: path.resolve(import.meta.dirname, '../../../../data/market-scans'),
      })
    );
  });

  it('runs the actual durable market job once with offline provider and enrichment injections', async () => {
    const dependencies = await fixture();
    delete dependencies.createJob;
    delete dependencies.runJob;
    delete dependencies.getJob;
    delete dependencies.pauseJob;
    dependencies.collect = vi.fn(async () => ({
      ...collection,
      provenance: { ...collection.provenance!, capturedAt: new Date().toISOString() },
    }));
    const analyze = vi.fn(async () => null);
    const build = vi.fn(async () => ({
      title: '시장 후보 스크리닝 · BUY · 자료 없음',
      asOf: 'today',
      summary: '일치 종목 없음.',
    }));
    dependencies.marketDependencies = {
      analyzeTickerContext: analyze,
      minIntervalMs: 0,
      buildStockReportWhatsAppNotification: build,
    };
    const result = await runDailyReport({}, dependencies);
    expect(result).toMatchObject({ status: 'unavailable', notificationStatus: 'accepted' });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(build).toHaveBeenCalledTimes(1);
    expect(dependencies.send).toHaveBeenCalledTimes(1);
    const jobs = (await readdir(dependencies.marketRootDirectory!)).filter((entry) =>
      /^[a-f\d-]{36}$/.test(entry)
    );
    expect(jobs).toHaveLength(1);
    expect(
      JSON.parse(
        await readFile(path.join(dependencies.marketRootDirectory!, jobs[0], 'state.json'), 'utf8')
      )
    ).toMatchObject({
      usSession: SESSION,
      universe: {
        source: 'finviz-candidates',
        validated: false,
        collectionReason: 'candidate-limit',
      },
      outcome: { collection: 'capped', analysis: 'unavailable' },
    });
    // The market job finalizes its own attempt record after the sender resolves.
    const notificationFile = path.join(
      dependencies.marketRootDirectory!,
      jobs[0],
      'notification.json'
    );
    let attempt: { result: unknown } = { result: null };
    for (let poll = 0; poll < 200 && attempt.result === null; poll++) {
      attempt = JSON.parse(await readFile(notificationFile, 'utf8'));
      if (attempt.result === null) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(attempt).toMatchObject({ result: { status: 'accepted' } });
  });

  it('runs the configured universe through the real durable job with the validated provenance', async () => {
    const dependencies = await fixture({});
    delete dependencies.createJob;
    delete dependencies.runJob;
    delete dependencies.getJob;
    delete dependencies.pauseJob;
    const analyze = vi.fn(async () => null);
    dependencies.marketDependencies = {
      analyzeTickerContext: analyze,
      minIntervalMs: 0,
      buildStockReportWhatsAppNotification: vi.fn(async () => ({
        title: '시장 후보 스크리닝 · BUY · 자료 없음',
        asOf: 'today',
        summary: '일치 종목 없음.',
      })),
    };
    const result = await runDailyReport({}, dependencies);
    expect(result).toMatchObject({ status: 'unavailable', universeSource: 'configured-universe' });
    expect(analyze).toHaveBeenCalledTimes(2);
    const jobs = (await readdir(dependencies.marketRootDirectory!)).filter((entry) =>
      /^[a-f\d-]{36}$/.test(entry)
    );
    expect(jobs).toHaveLength(1);
    expect(
      JSON.parse(
        await readFile(path.join(dependencies.marketRootDirectory!, jobs[0], 'state.json'), 'utf8')
      )
    ).toMatchObject({
      universe: {
        source: 'configured-universe',
        validated: true,
        name: CONFIGURED_UNIVERSE_NAME,
        collectedCount: 2,
        completeness: 'complete',
      },
    });
  });
});
