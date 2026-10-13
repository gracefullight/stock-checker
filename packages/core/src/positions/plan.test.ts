import { describe, expect, it } from 'vitest';
import { buildPositionPlan, positionTiming, resolvePositionSizing } from '@/positions/plan';

// Sydney Wednesday 2026-10-07 09:00 AEDT = New York Tuesday 2026-10-06 18:00 EDT.
const MORNING = new Date('2026-10-06T22:00:00Z');

describe('buildPositionPlan', () => {
  it('schedules the next open and the fifth session close from the shared calendar', () => {
    const plan = buildPositionPlan('2026-10-06');
    expect(plan.status).toBe('planned');
    expect(plan.sessions).toEqual([
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-12',
      '2026-10-13',
    ]);
    expect(plan.entrySession).toBe('2026-10-07');
    expect(plan.exitSession).toBe('2026-10-13');
    expect(plan.entryOpenAt).toBe('2026-10-07T13:30:00.000Z');
    expect(plan.exitCloseAt).toBe('2026-10-13T20:00:00.000Z');
    expect(plan.exitEarlyClose).toBe(false);
  });

  it('skips Thanksgiving and honors the early close on the following Friday', () => {
    expect(buildPositionPlan('2026-11-20').exitSession).toBe('2026-11-30');
    const early = buildPositionPlan('2026-11-19');
    expect(early.exitSession).toBe('2026-11-27');
    expect(early.exitEarlyClose).toBe(true);
    expect(early.exitCloseAt).toBe('2026-11-27T18:00:00.000Z');
  });

  it('fails closed for non-sessions and windows beyond the verified calendar', () => {
    expect(buildPositionPlan('2026-10-11').status).toBe('unavailable');
    expect(buildPositionPlan('2026-11-26').status).toBe('unavailable');
    expect(buildPositionPlan('2025-10-06').status).toBe('unavailable');
    expect(buildPositionPlan('not-a-date').status).toBe('unavailable');
    const outside = buildPositionPlan('2028-12-28');
    expect(outside.status).toBe('unavailable');
    expect(outside.sessions).toEqual([]);
  });
});

describe('positionTiming', () => {
  it('reports the entry reminder when the next open is the entry session', () => {
    const timing = positionTiming(buildPositionPlan('2026-10-06'), MORNING);
    expect(timing).toMatchObject({
      stage: 'entry',
      dayCount: 0,
      nextOpenSession: '2026-10-07',
      latestCompletedSession: '2026-10-06',
    });
  });

  it('keeps the entry reminder across a weekend and a holiday', () => {
    // Sunday 09:00 Sydney: Friday's BUY enters Monday.
    expect(
      positionTiming(buildPositionPlan('2026-10-02'), new Date('2026-10-03T22:00:00Z')).stage
    ).toBe('entry');
    // Thanksgiving Thursday morning in Sydney: Wednesday's BUY enters Friday.
    expect(
      positionTiming(buildPositionPlan('2026-11-25'), new Date('2026-11-26T22:00:00Z')).stage
    ).toBe('entry');
  });

  it('flags the morning before the exit session and counts completed holding days', () => {
    const exitEve = positionTiming(buildPositionPlan('2026-09-30'), MORNING);
    expect(exitEve).toMatchObject({ stage: 'exit-eve', dayCount: 4 });
    const holding = positionTiming(buildPositionPlan('2026-10-02'), MORNING);
    expect(holding).toMatchObject({ stage: 'holding', dayCount: 2 });
  });

  it('marks positions overdue once the exit close has passed, including early closes', () => {
    expect(positionTiming(buildPositionPlan('2026-09-29'), MORNING).stage).toBe('exit-passed');
    const early = buildPositionPlan('2026-11-19');
    expect(positionTiming(early, new Date('2026-11-27T17:59:00Z')).stage).toBe('holding');
    expect(positionTiming(early, new Date('2026-11-27T18:00:00Z')).stage).toBe('exit-passed');
  });

  it('never schedules an unavailable plan', () => {
    expect(positionTiming(buildPositionPlan('2026-10-11'), MORNING).stage).toBe('unplanned');
  });
});

describe('resolvePositionSizing', () => {
  it('defaults to five concurrent positions without capital', () => {
    expect(resolvePositionSizing({})).toEqual({
      capital: null,
      maxPositions: 5,
      weightPct: 20,
      perPosition: null,
      invalid: [],
    });
  });

  it('derives the per-position amount and ignores invalid values', () => {
    expect(
      resolvePositionSizing({ POSITIONS_CAPITAL: '10,000', POSITIONS_MAX_POSITIONS: '4' })
    ).toMatchObject({ capital: 10_000, maxPositions: 4, weightPct: 25, perPosition: 2500 });
    expect(
      resolvePositionSizing({ POSITIONS_CAPITAL: '-5', POSITIONS_MAX_POSITIONS: '2.5' })
    ).toMatchObject({
      capital: null,
      maxPositions: 5,
      invalid: ['POSITIONS_CAPITAL', 'POSITIONS_MAX_POSITIONS'],
    });
    expect(resolvePositionSizing({ POSITIONS_MAX_POSITIONS: '50' }).invalid).toEqual([
      'POSITIONS_MAX_POSITIONS',
    ]);
  });
});
