import { describe, expect, it } from 'vitest';
import { INDICATOR_ZONES, indicatorZone, zoneTextClass } from '@/lib/indicator-zones';

describe('indicatorZone', () => {
  it('classifies RSI, stochastic and Williams %R with the same comparator', () => {
    expect(indicatorZone(75, INDICATOR_ZONES.rsi)).toBe('overbought');
    expect(indicatorZone(25, INDICATOR_ZONES.rsi)).toBe('oversold');
    expect(indicatorZone(50, INDICATOR_ZONES.rsi)).toBe('neutral');
    expect(indicatorZone(85, INDICATOR_ZONES.stochK)).toBe('overbought');
    expect(indicatorZone(-85, INDICATOR_ZONES.williamsR)).toBe('oversold');
    expect(indicatorZone(-10, INDICATOR_ZONES.williamsR)).toBe('overbought');
  });

  it('never maps an indicator extreme to the buy or sell colours', () => {
    expect(zoneTextClass('overbought')).toBe('text-warning');
    expect(zoneTextClass('oversold')).toBe('text-warning');
    expect(zoneTextClass('neutral')).toBe('text-foreground');
  });

  it('treats non-finite values as neutral', () => {
    expect(indicatorZone(Number.NaN, INDICATOR_ZONES.rsi)).toBe('neutral');
  });
});
