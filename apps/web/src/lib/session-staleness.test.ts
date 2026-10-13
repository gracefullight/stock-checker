import { describe, expect, it } from 'vitest';
import { latestSessionDate, sessionStaleness } from '@/lib/session-staleness';

const today = new Date('2026-10-14T03:00:00Z');

describe('sessionStaleness', () => {
  it('accepts a session from the previous trading day', () => {
    expect(sessionStaleness('2026-10-13', { today })).toEqual({
      stale: false,
      ageDays: 1,
      reason: null,
      message: '',
    });
  });

  it('tolerates a long weekend but flags sessions older than the allowed age', () => {
    expect(sessionStaleness('2026-10-09', { today }).stale).toBe(false);
    const stale = sessionStaleness('2026-10-06', { today });
    expect(stale.stale).toBe(true);
    expect(stale.reason).toBe('too-old');
    expect(stale.message).toContain('8일 전');
  });

  it('flags a row that trails the newest session in the same table', () => {
    const stale = sessionStaleness('2026-10-10', { today, latest: '2026-10-13' });
    expect(stale.reason).toBe('behind-latest');
    expect(stale.message).toContain('2026-10-10');
  });

  it('treats missing or unparsable dates as stale', () => {
    expect(sessionStaleness(null, { today }).stale).toBe(true);
    expect(sessionStaleness('not-a-date', { today }).stale).toBe(true);
  });

  it('finds the newest session across rows', () => {
    expect(latestSessionDate(['2026-10-10', null, '2026-10-13', 'bad'])).toBe('2026-10-13');
    expect(latestSessionDate([])).toBeNull();
  });
});
