import { afterEach, describe, expect, it } from 'vitest';
import { appendPositionDigest, buildPositionDigest } from '@/positions/digest';
import {
  cleanupRoots,
  JOB_A,
  JOB_B,
  JOB_C,
  JOB_D,
  JOB_E,
  temporaryRoot,
  writeFixtureJob,
} from '@/positions/fixtures.test-helpers';
import { closePosition, recordPositionFill } from '@/positions/ledger';

// Sydney Wednesday 2026-10-07 09:00 AEDT (Tuesday 2026-10-06 18:00 in New York).
const MORNING = new Date('2026-10-06T22:00:00Z');

afterEach(cleanupRoots);

async function lifecycleFixture() {
  const { market, positions } = await temporaryRoot();
  // Exit passed: signal 09-29 → exit 10-06 (closed 20:00Z) with a completed paper row.
  await writeFixtureJob(market, {
    id: JOB_A,
    createdAt: '2026-09-29T22:05:00Z',
    notification: { status: 'accepted' },
    matches: [{ index: 0, ticker: 'AMD', dataAsOf: '2026-09-29' }],
    performance: [{ index: 0, ticker: 'AMD', status: 'completed', netReturnPct: 1.234 }],
  });
  // Exit eve: signal 09-30 → exit 10-07.
  await writeFixtureJob(market, {
    id: JOB_B,
    createdAt: '2026-09-30T22:05:00Z',
    notification: { status: 'accepted' },
    matches: [{ index: 0, ticker: 'NVDA', dataAsOf: '2026-09-30' }],
  });
  // Holding (2/5): signal 10-02 → entry 10-05.
  await writeFixtureJob(market, {
    id: JOB_C,
    createdAt: '2026-10-02T22:05:00Z',
    notification: { status: 'accepted' },
    matches: [
      { index: 0, ticker: 'TSLA', dataAsOf: '2026-10-02' },
      { index: 1, ticker: 'ZZZQ', dataAsOf: '2026-10-02' },
    ],
  });
  // Entry reminder: signal 10-06 → entry 10-07 (the next open).
  await writeFixtureJob(market, {
    id: JOB_D,
    createdAt: '2026-10-06T21:30:00Z',
    notification: { status: 'accepted' },
    matches: [{ index: 0, ticker: 'AAPL', dataAsOf: '2026-10-06' }],
  });
  // The scan being sent right now: its send is in flight and it decided SELL on held TSLA.
  await writeFixtureJob(market, {
    id: JOB_E,
    createdAt: '2026-10-06T22:01:00Z',
    notification: 'in-flight',
    matches: [
      { index: 0, ticker: 'MSFT', dataAsOf: '2026-10-06' },
      { index: 1, ticker: 'TSLA', dataAsOf: '2026-10-06', decision: 'SELL', kind: 'excluded' },
    ],
  });
  return { market, positions };
}

describe('buildPositionDigest', () => {
  it('classifies every ledger row for the Sydney morning and reads paper and SELL context', async () => {
    const { market, positions } = await lifecycleFixture();
    const dependencies = {
      marketRootDirectory: market,
      positionsRootDirectory: positions,
      environment: { POSITIONS_CAPITAL: '10000' },
    };
    const digest = await buildPositionDigest({
      ...dependencies,
      now: MORNING,
      currentJobId: JOB_E,
    });
    expect(digest.nextOpenSession).toBe('2026-10-07');
    expect(digest.latestCompletedSession).toBe('2026-10-06');
    expect(
      digest.items.map((item) => [item.entry.ticker, item.kind, item.timing.dayCount])
    ).toEqual([
      ['NVDA', 'exit-eve', 4],
      ['AMD', 'exit-passed', 5],
      ['AAPL', 'entry', 0],
      ['TSLA', 'holding', 2],
    ]);
    expect(digest.items[1].paper).toEqual({
      status: 'completed',
      netReturnPct: 1.234,
      outcome: 'win',
    });
    expect(digest.items[3].sellSignal).toBe(true);
    expect(digest.items[0].sellSignal).toBe(false);
    expect(digest.excluded).toEqual([
      {
        ticker: 'ZZZQ',
        signalSession: '2026-10-02',
        reason: expect.stringContaining('검증 범위 밖'),
      },
    ]);
    expect(digest.sizing).toMatchObject({ capital: 10_000, maxPositions: 5, perPosition: 2000 });
    expect(digest.warnings).toEqual([]);
  });

  it('reflects recorded fills and closes and hides stale closes', async () => {
    const { market, positions } = await lifecycleFixture();
    const dependencies = {
      marketRootDirectory: market,
      positionsRootDirectory: positions,
      environment: {},
    };
    await buildPositionDigest({ ...dependencies, now: MORNING });
    const ledgerDependencies = { ...dependencies, now: () => MORNING };
    await recordPositionFill(
      { ticker: 'TSLA', session: '2026-10-02', price: 200, size: 5 },
      ledgerDependencies
    );
    await recordPositionFill(
      { ticker: 'AMD', session: '2026-09-29', price: 100, size: 10 },
      ledgerDependencies
    );
    await closePosition({ ticker: 'AMD', session: '2026-09-29', price: 101 }, ledgerDependencies);
    await closePosition(
      { ticker: 'NVDA', session: '2026-09-30', price: 50 },
      { ...dependencies, now: () => new Date('2026-10-01T22:00:00Z') }
    );
    const digest = await buildPositionDigest({ ...dependencies, now: MORNING, sync: false });
    expect(digest.items.map((item) => [item.entry.ticker, item.kind])).toEqual([
      ['AAPL', 'entry'],
      ['TSLA', 'holding'],
      ['AMD', 'closed'],
    ]);
    expect(digest.items[1].entry.fill).toMatchObject({ price: 200, size: 5 });
    expect(digest.items[2].actualReturnPct).toBeCloseTo(1, 6);
    expect(digest.items[2].paper?.netReturnPct).toBe(1.234);
  });
});

describe('appendPositionDigest', () => {
  it('leaves a notification untouched when the ledger has nothing to show', async () => {
    const { market, positions } = await temporaryRoot();
    const notification = { title: 't', asOf: 'a', summary: 'OII BUY' };
    const result = await appendPositionDigest(notification, {
      now: MORNING,
      marketRootDirectory: market,
      positionsRootDirectory: positions,
      environment: {},
    });
    expect(result).toBe(notification);
  });

  it('appends the section within the 3,000-unit budget, trimming screening text for reminders', async () => {
    const { market, positions } = await lifecycleFixture();
    const options = {
      now: MORNING,
      marketRootDirectory: market,
      positionsRootDirectory: positions,
      environment: {},
      currentJobId: JOB_E,
    };
    const short = await appendPositionDigest(
      { title: 't', asOf: 'a', summary: 'OII BUY' },
      options
    );
    expect(short.summary.startsWith('OII BUY\n\n*보유 계획 · 다음 개장 10-07(수)*')).toBe(true);
    expect(short.summary).toContain('*NVDA · 오늘 밤 청산*');
    expect(short.summary).toContain('*AAPL · 진입 예정*');
    const paragraphs = Array.from({ length: 40 }, (_, index) => `${index} ${'x'.repeat(70)}`);
    const long = paragraphs.join('\n\n');
    expect(long.length).toBeGreaterThan(2800);
    const trimmed = await appendPositionDigest({ title: 't', asOf: 'a', summary: long }, options);
    expect(trimmed.summary.length).toBeLessThanOrEqual(3000);
    expect(trimmed.summary).toContain('일부 상세는 길이 제한으로 생략.');
    expect(trimmed.summary).toContain('*NVDA · 오늘 밤 청산*');
    expect(trimmed.summary).toContain('*AMD · 청산 확인 필요*');
    expect(trimmed.summary.startsWith('0 xxx')).toBe(true);
  });
});
