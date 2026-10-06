import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type DailyReportDependencies,
  dailyReportSchedule,
  parseDailyReportArguments,
  readDailyReportStatus,
  runDailyReport,
} from '@/commands/daily-report';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import type { FinvizCollectionResult } from '@/reports/finviz-collector';
import type { MarketScreenDependencies, MarketScreenJobSnapshot } from '@/reports/market-screen';
import type { StockScreenMatch } from '@/reports/stock-screen';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const morning = new Date('2026-10-06T22:00:00Z'); // Sydney October 7, 09:00 AEDT.
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
  },
  reason: null,
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
        url: collection.provenance?.url ?? '',
        filters: ['ind_stocksonly', 'ta_sma50_pb'],
        sourceTotal: 3916,
        collectedCount: 2,
        inputCount: 2,
        capturedAt: morning.toISOString(),
        completeness: 'partial',
        overallTotal: null,
        pages: 1,
      },
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

async function fixture(): Promise<DailyReportDependencies & { rootDirectory: string }> {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), 'stock-checker-daily-'));
  roots.push(rootDirectory);
  return {
    rootDirectory,
    marketRootDirectory: path.join(rootDirectory, 'market'),
    environment: {},
    now: () => morning,
    isConfigured: vi.fn(async () => true),
    isBrowserAvailable: vi.fn(async () => true),
    collect: vi.fn(async () => structuredClone(collection)),
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
  };
}

describe('Sydney morning schedule', () => {
  it('uses Sydney DST rather than the host timezone and admits only the morning window', () => {
    expect(dailyReportSchedule(morning)).toMatchObject({
      localDate: '2026-10-07',
      eligible: true,
      timezone: 'Australia/Sydney',
    });
    expect(dailyReportSchedule(new Date('2026-07-07T23:14:59Z'))).toMatchObject({
      localDate: '2026-07-08',
      eligible: true,
    });
    expect(dailyReportSchedule(new Date('2026-07-07T23:15:00Z')).eligible).toBe(false);
    expect(dailyReportSchedule(new Date('2026-10-07T03:00:00Z')).eligible).toBe(false);
    expect(dailyReportSchedule(new Date('2026-10-06T21:59:59Z')).eligible).toBe(false);
  });

  it('limits the CLI to explicit read-only status and dry-run modes', () => {
    expect(parseDailyReportArguments([])).toEqual('run');
    expect(parseDailyReportArguments(['--status'])).toEqual('status');
    expect(parseDailyReportArguments(['--dry-run'])).toEqual('dry-run');
    for (const arguments_ of [['--force'], ['--status', '--dry-run'], ['--dry-run', '--dry-run']]) {
      expect(() => parseDailyReportArguments(arguments_)).toThrow();
    }
  });
});

describe('daily screening dispatch', () => {
  it('dry-run and afternoon installation perform no collection, claims, market work or send', async () => {
    const dependencies = await fixture();
    expect(await runDailyReport({ dryRun: true }, dependencies)).toMatchObject({
      status: 'dry-run',
      eligible: true,
      maxCandidates: 200,
    });
    expect(await readdir(dependencies.rootDirectory)).toEqual([]);
    expect(dependencies.isConfigured).not.toHaveBeenCalled();
    expect(
      await runDailyReport({}, { ...dependencies, now: () => new Date('2026-10-07T03:00:00Z') })
    ).toMatchObject({ status: 'skipped', reason: 'outside-window' });
    for (const operation of [dependencies.collect, dependencies.createJob, dependencies.send])
      expect(operation).not.toHaveBeenCalled();
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
      expect(notification.title).toContain('Finviz 후보 2/3916 (부분)');
      expect(notification.summary).toContain('과거 BUY 20표본');
      return { status: 'accepted' as const, messageId: 'offline-id' };
    });
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'partial',
      notificationStatus: 'accepted',
      collectedCount: 2,
      sourceTotal: 3916,
    });
    expect(dependencies.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        tickers: ['OII', 'AAPL'],
        provenance: collection.provenance,
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

  it('collection failure sends one failure report without inventing candidates or source total', async () => {
    const dependencies = await fixture();
    dependencies.collect = vi.fn(async () => ({
      status: 'unavailable' as const,
      tickers: [],
      provenance: null,
      reason: null,
    }));
    expect(await runDailyReport({}, dependencies)).toMatchObject({
      status: 'unavailable',
      sourceTotal: null,
      notificationStatus: 'accepted',
    });
    expect(dependencies.createJob).not.toHaveBeenCalled();
    expect(dependencies.send).toHaveBeenCalledTimes(1);
    expect(dependencies.send).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('수집 실패'),
        summary: expect.stringContaining('분석은 시작하지 않았습니다'),
      })
    );
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
        status: 'partial',
        notificationStatus: 'accepted',
        collectedCount: 2,
        sourceTotal: 3916,
      },
    });
    expect(dependencies.collect).toHaveBeenCalledTimes(1);
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
        await readFile(
          path.join(dependencies.marketRootDirectory!, jobs[0], 'notification.json'),
          'utf8'
        )
      )
    ).toMatchObject({ result: { status: 'accepted' } });
  });
});
