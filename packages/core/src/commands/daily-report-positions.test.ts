import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DailyReportDependencies, runDailyReport } from '@/commands/daily-report';
import { JOB_A, writeFixtureJob } from '@/positions/fixtures.test-helpers';
import type { FinvizCollectionResult } from '@/reports/finviz-collector';
import type { MarketScreenJobSnapshot } from '@/reports/market-screen';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// Sydney Wednesday 2026-10-07 09:00 AEDT.
const morning = new Date('2026-10-06T22:00:00Z');
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

function snapshot(status: 'paused' | 'partial' = 'partial'): MarketScreenJobSnapshot {
  return {
    job: {
      schemaVersion: 1,
      id: 'e6dd2673-35f9-4947-9353-1c70a2f154ed',
      status,
      createdAt: morning.toISOString(),
      updatedAt: morning.toISOString(),
      startedAt: morning.toISOString(),
      finishedAt: status === 'partial' ? morning.toISOString() : null,
      pauseReason: null,
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
        analyzed: 2,
        unavailable: 0,
        pending: 0,
        inFlight: 0,
        matched: 0,
        excluded: 2,
      },
      warnings: [],
    },
    page: { kind: 'matches', offset: 0, limit: 3, total: 0, hasMore: false, items: [] },
  };
}

const ORIGINAL_SUMMARY = 'OII BUY\n과거 BUY 20표본 · 승률 60%';

async function fixture(): Promise<
  DailyReportDependencies & { rootDirectory: string; marketRootDirectory: string }
> {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), 'stock-checker-daily-positions-'));
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
        summary: ORIGINAL_SUMMARY,
      });
      return snapshot();
    }),
    getJob: vi.fn(async () => snapshot()),
    pauseJob: vi.fn(async () => snapshot('paused')),
    hasJobNotificationAttempt: vi.fn(async () => false),
    pollIntervalMs: 1,
  };
}

describe('morning report position digest touch-point', () => {
  it('appends 보유 계획 built from previously delivered BUYs to the sent message', async () => {
    const dependencies = await fixture();
    await writeFixtureJob(dependencies.marketRootDirectory, {
      id: JOB_A,
      createdAt: '2026-10-05T22:05:00Z',
      notification: { status: 'accepted' },
      matches: [{ index: 0, ticker: 'AAPL', dataAsOf: '2026-10-06' }],
    });
    const state = await runDailyReport({}, dependencies);
    expect(state).toMatchObject({ notificationStatus: 'accepted' });
    const sent = vi.mocked(dependencies.send!).mock.calls[0][0];
    expect(
      sent.summary.startsWith(`${ORIGINAL_SUMMARY}\n\n*보유 계획 · 다음 개장 10-07(수)*`)
    ).toBe(true);
    expect(sent.summary).toContain('*AAPL · 진입 예정*\n10-07(수) 시가 · 시드니 10-08 00:30');
    expect(sent.summary.length).toBeLessThanOrEqual(3000);
  });

  it('sends the original message when the ledger cannot be read', async () => {
    const dependencies = await fixture();
    // A file where the ledger directory should be makes every ledger read fail.
    await writeFile(path.join(dependencies.rootDirectory, 'positions'), 'not a directory');
    const state = await runDailyReport({}, dependencies);
    expect(state).toMatchObject({ notificationStatus: 'accepted' });
    expect(vi.mocked(dependencies.send!).mock.calls[0][0].summary).toBe(ORIGINAL_SUMMARY);
  });
});
