import { describe, expect, it } from 'vitest';
import {
  formatPaperPercentage,
  formatPaperPrice,
  formatPaperSession,
  formatPaperTimestamp,
} from '@/features/market-screen/utils/market-screen-performance-format';

describe('forward paper outcome formatting', () => {
  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, '0'])(
    'does not turn an unknown return or price into zero: %s',
    (value) => {
      expect(formatPaperPercentage(value)).toBe('—');
      expect(formatPaperPrice(value)).toBe('—');
    }
  );

  it('preserves known zero and negative returns and meaningful penny-price precision', () => {
    expect(formatPaperPercentage(0)).toBe('0.00%');
    expect(formatPaperPercentage(-0.125)).toBe('-0.13%');
    expect(formatPaperPrice(0.005)).toBe('$0.005');
    expect(formatPaperPrice(0.0000001)).toBe('1.000e-7 USD');
    expect(formatPaperPrice(0)).toBe('—');
  });

  it('uses explicit UTC timestamps and rejects impossible session dates', () => {
    expect(formatPaperTimestamp('2026-10-04T14:00:00+02:00')).toBe('2026-10-04 12:00:00 UTC');
    expect(formatPaperSession('2026-02-30')).toBe('—');
    expect(formatPaperSession('2026-10-02')).toBe('2026-10-02');
    expect(formatPaperTimestamp(null)).toBe('—');
  });
});
