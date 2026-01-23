import { INDICATOR_WEIGHTS, BUY_THRESHOLD, SELL_THRESHOLD } from '../constants';
import type { IndicatorValues } from '../types';

export function getOpinion(params: {
  rsi: number;
  stochasticK: number;
  williamsR: number;
  close: number;
  bbLower: number;
  bbUpper: number;
  donchLower: number;
  donchUpper: number;
  fearGreed: number | null;
  patternScore: number;
}): { decision: string; score: number } {
  const {
    rsi,
    stochasticK,
    williamsR,
    close,
    bbLower,
    bbUpper,
    donchLower,
    donchUpper,
    fearGreed,
    patternScore
  } = params;

  let buyScore = 0;
  if (rsi < 30) buyScore += INDICATOR_WEIGHTS.rsi;
  if (stochasticK < 20) buyScore += INDICATOR_WEIGHTS.stochastic;
  if (close <= bbLower) buyScore += INDICATOR_WEIGHTS.bollinger;
  if (close <= donchLower) buyScore += INDICATOR_WEIGHTS.donchian;
  if (williamsR < -80) buyScore += INDICATOR_WEIGHTS.williamsR;
  if ((fearGreed ?? 0) < 40) buyScore += INDICATOR_WEIGHTS.fearGreed;
  buyScore += patternScore;

  let sellScore = 0;
  if (rsi > 70) sellScore += INDICATOR_WEIGHTS.rsi;
  if (stochasticK > 80) sellScore += INDICATOR_WEIGHTS.stochastic;
  if (close >= bbUpper) sellScore += INDICATOR_WEIGHTS.bollinger;
  if (close >= donchUpper) sellScore += INDICATOR_WEIGHTS.donchian;
  if (williamsR > -20) sellScore += INDICATOR_WEIGHTS.williamsR;
  if ((fearGreed ?? 0) > 60) sellScore += INDICATOR_WEIGHTS.fearGreed;

  if (buyScore >= BUY_THRESHOLD && buyScore >= sellScore) {
    return { decision: 'BUY', score: buyScore };
  }
  if (sellScore >= SELL_THRESHOLD && sellScore > buyScore) {
    return { decision: 'SELL', score: sellScore };
  }
  return { decision: 'HOLD', score: Math.max(buyScore, sellScore) };
}