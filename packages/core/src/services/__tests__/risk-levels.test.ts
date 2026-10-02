import { describe, expect, it } from 'vitest';
import { REWARD_MULTIPLIER, RISK_MULTIPLIER } from '@/constants';
import { calculateLongRiskLevels } from '@/services/risk-levels';

describe('long-position risk references', () => {
  it('uses ATR in price units and keeps the existing reward-to-risk ratio', () => {
    const levels = calculateLongRiskLevels(100, 2);
    expect(levels).toEqual({ stopLoss: 97, takeProfit: 106, trailingStop: 97, trailingStart: 101 });
    expect(100 - (levels?.stopLoss ?? 0)).toBe(2 * RISK_MULTIPLIER);
    expect(((levels?.takeProfit ?? 0) - 100) / (100 - (levels?.stopLoss ?? 0))).toBe(
      REWARD_MULTIPLIER
    );
  });

  it.each([
    { close: 0, atr: 2 },
    { close: -100, atr: 2 },
    { close: Number.NaN, atr: 2 },
    { close: Number.POSITIVE_INFINITY, atr: 2 },
    { close: 100, atr: 0 },
    { close: 100, atr: -2 },
    { close: 100, atr: Number.NaN },
    { close: 100, atr: Number.POSITIVE_INFINITY },
    { close: 1, atr: 2 },
    { close: Number.MAX_VALUE, atr: Number.MAX_VALUE / 2 },
  ])('does not invent usable levels from close=$close, ATR=$atr', ({ close, atr }) => {
    expect(calculateLongRiskLevels(close, atr)).toBeNull();
  });
});
