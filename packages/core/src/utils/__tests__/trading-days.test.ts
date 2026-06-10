import { describe, expect, it } from 'vitest';
import { tradingDaysUntil } from '@/utils/trading-days';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('tradingDaysUntil', () => {
  it('returns 0 for the same day', () => {
    expect(tradingDaysUntil(d('2026-06-10'), d('2026-06-10'))).toBe(0);
  });

  it('counts weekdays within the same week', () => {
    // Wed -> Fri = Thu, Fri
    expect(tradingDaysUntil(d('2026-06-12'), d('2026-06-10'))).toBe(2);
  });

  it('skips weekends', () => {
    // Fri -> Mon = Mon only
    expect(tradingDaysUntil(d('2026-06-15'), d('2026-06-12'))).toBe(1);
    // Wed -> next Wed = Thu, Fri, Mon, Tue, Wed
    expect(tradingDaysUntil(d('2026-06-17'), d('2026-06-10'))).toBe(5);
  });

  it('returns 0 when target is a weekend right after from', () => {
    // Fri -> Sat: no weekdays in between
    expect(tradingDaysUntil(d('2026-06-13'), d('2026-06-12'))).toBe(0);
  });

  it('returns negative counts for past dates', () => {
    // Mon -> previous Fri = -1
    expect(tradingDaysUntil(d('2026-06-12'), d('2026-06-15'))).toBe(-1);
    expect(tradingDaysUntil(d('2026-06-10'), d('2026-06-17'))).toBe(-5);
  });
});
