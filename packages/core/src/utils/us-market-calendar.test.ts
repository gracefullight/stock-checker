import { describe, expect, it } from 'vitest';
import {
  isSession,
  latestCompletedSession,
  nextSessionOpen,
  sessionCloseAt,
  sessionsAfter,
} from '@/utils/us-market-calendar';

const ny = (iso: string) => new Date(iso).getTime();

describe('us-market-calendar', () => {
  it('recognizes weekdays, weekends, holidays, and unsupported years', () => {
    expect(isSession('2026-10-12')).toBe(true);
    expect(isSession('2026-10-11')).toBe(false);
    expect(isSession('2026-11-26')).toBe(false);
    expect(isSession('2025-10-13')).toBe(false);
    expect(isSession('not-a-date')).toBe(false);
  });

  it('counts holding sessions across Thanksgiving and skips the holiday', () => {
    expect(sessionsAfter('2026-11-20', 5)).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-27',
      '2026-11-30',
    ]);
    expect(sessionsAfter('2028-12-22', 10)).toBeNull();
  });

  it('closes early on the day after Thanksgiving', () => {
    expect(sessionCloseAt('2026-11-27')).toBe(ny('2026-11-27T13:00:00-05:00'));
    expect(sessionCloseAt('2026-10-12')).toBe(ny('2026-10-12T16:00:00-04:00'));
  });

  it('reports the latest completed session from a Sydney morning', () => {
    // 09:00 Tue Sydney (AEDT) = 18:00 Mon New York: Monday is complete.
    expect(latestCompletedSession(ny('2026-10-13T09:00:00+11:00'))).toBe('2026-10-12');
    // 09:00 Sun Sydney = Sat New York: still Friday's session.
    expect(latestCompletedSession(ny('2026-10-11T09:00:00+11:00'))).toBe('2026-10-09');
    // Before the close, the previous session is the latest completed one.
    expect(latestCompletedSession(ny('2026-10-12T15:59:00-04:00'))).toBe('2026-10-09');
    expect(latestCompletedSession(ny('2025-12-31T12:00:00Z'))).toBeNull();
  });

  it('finds the next open after weekends and holidays', () => {
    expect(nextSessionOpen(ny('2026-10-09T18:00:00-04:00'))).toBe('2026-10-12');
    expect(nextSessionOpen(ny('2026-11-25T18:00:00-05:00'))).toBe('2026-11-27');
    expect(nextSessionOpen(ny('2026-10-12T09:00:00-04:00'))).toBe('2026-10-12');
  });
});
