import { describe, expect, it } from 'vitest';
import { fixtureMarketScreenJob } from '@/features/market-screen/utils/market-screen-test-fixtures';
import {
  isStalePausedJob,
  isValidatedUniverseJob,
  jobOrigin,
  jobSessionDate,
  universeLabel,
} from '@/features/market-screen/utils/market-screen-universe';

describe('market-screen universe helpers', () => {
  it('labels Finviz-lane jobs as outside the validated universe', () => {
    const job = fixtureMarketScreenJob();
    expect(isValidatedUniverseJob(job)).toBe(false);
    expect(universeLabel(job)).toBe('검증 유니버스 외 · Finviz 후보');
  });

  it('labels configured-universe jobs as the validated universe once the source field changes', () => {
    const job = fixtureMarketScreenJob();
    job.universe.source = 'configured-universe';
    job.universe.label = 'leader-pullback-v1';
    expect(isValidatedUniverseJob(job)).toBe(true);
    expect(universeLabel(job)).toBe('검증 유니버스 · leader-pullback-v1');
  });

  it('derives the US session date from creation time and prefers a recorded session', () => {
    const job = fixtureMarketScreenJob();
    expect(jobSessionDate(job)).toBe('2026-10-03');
    expect(jobSessionDate({ ...job, sessionDate: '2026-10-02' })).toBe('2026-10-02');
  });

  it('treats paused jobs older than 48 hours as stale, never running or finished ones', () => {
    const paused = fixtureMarketScreenJob();
    const now = Date.parse('2026-10-06T12:00:00.000Z');
    expect(isStalePausedJob(paused, now)).toBe(true);
    expect(isStalePausedJob(paused, Date.parse('2026-10-04T12:00:00.000Z'))).toBe(false);
    expect(isStalePausedJob(fixtureMarketScreenJob(undefined, 'completed'), now)).toBe(false);
    expect(isStalePausedJob(fixtureMarketScreenJob(undefined, 'running'), now)).toBe(false);
  });

  it('falls back to the manual lane when a job carries no origin or label', () => {
    expect(jobOrigin(fixtureMarketScreenJob())).toBe('MCP / manual');
    expect(jobOrigin({ label: 'Daily report', origin: 'daily-report' })).toBe(
      'Daily report · daily-report'
    );
  });
});
