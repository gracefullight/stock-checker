import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupRoots,
  JOB_A,
  JOB_B,
  JOB_C,
  JOB_D,
  temporaryRoot,
  writeFixtureJob,
} from '@/positions/fixtures.test-helpers';
import {
  closePosition,
  isValidatedUniverseTicker,
  readPositionLedger,
  recordPositionFill,
  syncPositionsFromMarketScans,
} from '@/positions/ledger';

const NOW = new Date('2026-10-06T22:00:00Z');

afterEach(cleanupRoots);

describe('syncPositionsFromMarketScans', () => {
  it('creates rows only from BUYs whose notification was accepted and dedupes by ticker + session', async () => {
    const { market, positions } = await temporaryRoot();
    await writeFixtureJob(market, {
      id: JOB_A,
      createdAt: '2026-10-03T22:05:00Z',
      notification: { status: 'accepted' },
      matches: [
        { index: 0, ticker: 'AAPL', dataAsOf: '2026-10-02' },
        { index: 1, ticker: 'ZZZQ', dataAsOf: '2026-10-02' },
        { index: 2, ticker: 'NVDA', dataAsOf: '2026-10-02', registrationStatus: 'ineligible' },
        { index: 3, ticker: 'TSLA', dataAsOf: '2026-10-02', decision: 'SELL', kind: 'excluded' },
      ],
    });
    // Sunday re-send of the same Friday session: same AAPL key, must not duplicate.
    await writeFixtureJob(market, {
      id: JOB_B,
      createdAt: '2026-10-04T22:05:00Z',
      notification: { status: 'accepted' },
      matches: [{ index: 0, ticker: 'AAPL', dataAsOf: '2026-10-02' }],
    });
    await writeFixtureJob(market, {
      id: JOB_C,
      createdAt: '2026-10-05T22:05:00Z',
      notification: { status: 'failed' },
      matches: [{ index: 0, ticker: 'AMD', dataAsOf: '2026-10-05' }],
    });
    await writeFixtureJob(market, {
      id: JOB_D,
      createdAt: '2026-10-06T22:05:00Z',
      notification: 'in-flight',
      matches: [{ index: 0, ticker: 'MSFT', dataAsOf: '2026-10-06' }],
    });
    const dependencies = {
      marketRootDirectory: market,
      positionsRootDirectory: positions,
      environment: {},
      now: () => NOW,
    };
    const first = await syncPositionsFromMarketScans(dependencies);
    expect(first.created.map((entry) => entry.key).sort()).toEqual([
      'AAPL:2026-10-02',
      'NVDA:2026-10-02',
      'ZZZQ:2026-10-02',
    ]);
    expect(first.scannedJobs).toBe(4);
    const ledger = await readPositionLedger(dependencies);
    const byTicker = Object.fromEntries(ledger.entries.map((entry) => [entry.ticker, entry]));
    expect(byTicker.AAPL).toMatchObject({
      inPlan: true,
      validatedUniverse: true,
      source: { kind: 'daily-report', jobId: JOB_A, recommendationIndex: 0 },
      plan: { status: 'planned', entrySession: '2026-10-05', exitSession: '2026-10-09' },
      reference: { price: 100, stopLoss: 95, takeProfit: 110, atr: 3 },
    });
    expect(byTicker.ZZZQ).toMatchObject({ inPlan: false, validatedUniverse: false });
    // An ineligible registration keeps the row but out of the plan.
    expect(byTicker.NVDA).toMatchObject({ inPlan: false, validatedUniverse: true });
    expect(byTicker.NVDA.plan.status).toBe('unavailable');
    expect(byTicker.TSLA).toBeUndefined();
    expect(byTicker.AMD).toBeUndefined();
    expect(byTicker.MSFT).toBeUndefined();
    // Accepted and failed jobs are indexed; the in-flight job is re-read next time.
    const index = JSON.parse(await readFile(path.join(positions, '.sync.json'), 'utf8'));
    expect(Object.keys(index.jobs).sort()).toEqual([JOB_A, JOB_B, JOB_C]);
    await writeFixtureJob(market, {
      id: JOB_D,
      createdAt: '2026-10-06T22:05:00Z',
      notification: { status: 'accepted' },
      matches: [{ index: 0, ticker: 'MSFT', dataAsOf: '2026-10-06' }],
    });
    const second = await syncPositionsFromMarketScans(dependencies);
    expect(second.created.map((entry) => entry.key)).toEqual(['MSFT:2026-10-06']);
    expect(second.scannedJobs).toBe(1);
    expect((await readdir(positions)).filter((name) => !name.startsWith('.'))).toHaveLength(4);
  });

  it('skips the job being sent right now and honors the opt-in for unvalidated tickers', async () => {
    const { market, positions } = await temporaryRoot();
    await writeFixtureJob(market, {
      id: JOB_A,
      createdAt: '2026-10-05T22:05:00Z',
      notification: { status: 'accepted' },
      matches: [{ index: 0, ticker: 'ZZZQ', dataAsOf: '2026-10-05' }],
    });
    await writeFixtureJob(market, {
      id: JOB_B,
      createdAt: '2026-10-06T22:05:00Z',
      notification: { status: 'accepted' },
      matches: [{ index: 0, ticker: 'AAPL', dataAsOf: '2026-10-06' }],
    });
    const dependencies = {
      marketRootDirectory: market,
      positionsRootDirectory: positions,
      environment: { POSITIONS_INCLUDE_UNVALIDATED: '1' },
      now: () => NOW,
    };
    const result = await syncPositionsFromMarketScans(dependencies, { excludeJobId: JOB_B });
    expect(result.created.map((entry) => entry.key)).toEqual(['ZZZQ:2026-10-05']);
    expect(result.created[0].inPlan).toBe(true);
    expect(result.skippedJobs).toBe(1);
  });

  it('prefers an explicit validated-universe tag on the saved match', async () => {
    const { market, positions } = await temporaryRoot();
    await writeFixtureJob(market, {
      id: JOB_A,
      createdAt: '2026-10-05T22:05:00Z',
      notification: { status: 'accepted' },
      matches: [
        { index: 0, ticker: 'ZZZQ', dataAsOf: '2026-10-05', validatedUniverse: true },
        { index: 1, ticker: 'AAPL', dataAsOf: '2026-10-05', validatedUniverse: false },
      ],
    });
    const result = await syncPositionsFromMarketScans({
      marketRootDirectory: market,
      positionsRootDirectory: positions,
      environment: {},
      now: () => NOW,
    });
    const flags = Object.fromEntries(
      result.created.map((entry) => [entry.ticker, [entry.validatedUniverse, entry.inPlan]])
    );
    expect(flags).toEqual({ ZZZQ: [true, true], AAPL: [false, false] });
    expect(isValidatedUniverseTicker('AAPL')).toBe(true);
    expect(isValidatedUniverseTicker('ZZZQ')).toBe(false);
  });

  it('returns an empty result when no market scans exist', async () => {
    const { market, positions } = await temporaryRoot();
    const result = await syncPositionsFromMarketScans({
      marketRootDirectory: market,
      positionsRootDirectory: positions,
      environment: {},
    });
    expect(result).toEqual({ created: [], scannedJobs: 0, skippedJobs: 0 });
  });
});

describe('fills and closes', () => {
  it('records a fill on a synced row, creates manual rows, and closes with the latest session', async () => {
    const { market, positions } = await temporaryRoot();
    await writeFixtureJob(market, {
      id: JOB_A,
      createdAt: '2026-10-03T22:05:00Z',
      notification: { status: 'accepted' },
      matches: [{ index: 0, ticker: 'AAPL', dataAsOf: '2026-10-02' }],
    });
    const dependencies = {
      marketRootDirectory: market,
      positionsRootDirectory: positions,
      environment: {},
      now: () => NOW,
    };
    await syncPositionsFromMarketScans(dependencies);
    const filled = await recordPositionFill(
      { ticker: 'aapl', session: '2026-10-02', price: 123.45, size: 10, note: ' broker A ' },
      dependencies
    );
    expect(filled.fill).toEqual({
      price: 123.45,
      size: 10,
      recordedAt: NOW.toISOString(),
      note: 'broker A',
    });
    expect(filled.source.kind).toBe('daily-report');
    const manual = await recordPositionFill(
      { ticker: 'MSFT', session: '2026-10-05', price: 400, size: 2 },
      dependencies
    );
    expect(manual.source).toEqual({ kind: 'manual', createdBy: 'cli' });
    expect(manual.plan.exitSession).toBe('2026-10-12');
    const closed = await closePosition(
      { ticker: 'AAPL', session: '2026-10-02', price: 125.1 },
      dependencies
    );
    expect(closed.close).toEqual({
      price: 125.1,
      session: '2026-10-06',
      recordedAt: NOW.toISOString(),
      note: null,
    });
    await expect(
      closePosition({ ticker: 'AAPL', session: '2026-10-02', price: 1 }, dependencies)
    ).rejects.toThrow('already closed');
    await expect(
      closePosition({ ticker: 'NVDA', session: '2026-10-02', price: 1 }, dependencies)
    ).rejects.toThrow('No position');
    await expect(
      recordPositionFill({ ticker: 'AAPL', session: '2026-10-03', price: 1, size: 1 }, dependencies)
    ).rejects.toThrow('session');
    await expect(
      recordPositionFill(
        { ticker: 'bad ticker', session: '2026-10-02', price: 1, size: 1 },
        dependencies
      )
    ).rejects.toThrow('ticker');
    await expect(
      recordPositionFill({ ticker: 'AAPL', session: '2026-10-02', price: 0, size: 1 }, dependencies)
    ).rejects.toThrow('price');
    const ledger = await readPositionLedger(dependencies);
    expect(ledger.entries.map((entry) => entry.key)).toEqual([
      'MSFT:2026-10-05',
      'AAPL:2026-10-02',
    ]);
    expect(ledger.unreadable).toBe(0);
  });
});
