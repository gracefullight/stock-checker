import { describe, expect, it } from 'vitest';
import { usSessionDate } from '@/lib/us-session-date';

describe('usSessionDate', () => {
  it('maps a Sydney-morning timestamp to the previous New York calendar date', () => {
    // 2026-10-14 09:00 AEDT == 2026-10-13 22:00 UTC == 2026-10-13 18:00 EDT
    expect(usSessionDate('2026-10-13T22:00:00.000Z')).toBe('2026-10-13');
  });

  it('keeps a New York daytime timestamp on the same date', () => {
    expect(usSessionDate('2026-10-03T12:00:00.000Z')).toBe('2026-10-03');
  });

  it('returns null for missing or invalid input', () => {
    expect(usSessionDate(null)).toBeNull();
    expect(usSessionDate('nope')).toBeNull();
  });
});
