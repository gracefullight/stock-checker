import {
  REWARD_MULTIPLIER,
  RISK_MULTIPLIER,
  TRAILING_ACTIVATION_MULTIPLIER,
  TRAILING_MULTIPLIER,
} from '@/constants';

export interface LongRiskLevels {
  stopLoss: number;
  takeProfit: number;
  trailingStop: number;
  trailingStart: number;
}

/** Long-position references only: SELL is an exit signal, never a short entry. */
export function calculateLongRiskLevels(close: number, atr: number): LongRiskLevels | null {
  if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(atr) || atr <= 0) return null;

  const risk = atr * RISK_MULTIPLIER;
  const stopLoss = close - risk;
  const takeProfit = close + risk * REWARD_MULTIPLIER;
  const trailingStop = Math.min(stopLoss, close - TRAILING_MULTIPLIER * atr);
  const trailingStart = close + TRAILING_ACTIVATION_MULTIPLIER * atr;
  const levels = { stopLoss, takeProfit, trailingStop, trailingStart };

  if (Object.values(levels).some((level) => !Number.isFinite(level) || level <= 0)) return null;
  return levels;
}
