import { BUY_THRESHOLD, INDICATOR_WEIGHTS, SELL_THRESHOLD } from '@/constants';

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
  macd?: number;
  macdSignal?: number;
  macdHistogram?: number;
  sma20?: number;
  ema20?: number;
  buyThreshold?: number;
  sellThreshold?: number;
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
    patternScore,
    buyThreshold,
    sellThreshold,
    macdHistogram,
    sma20,
    ema20,
  } = params;

  let buyScore = 0;
  if (rsi < 30) buyScore += INDICATOR_WEIGHTS.rsi;
  if (stochasticK < 20) buyScore += INDICATOR_WEIGHTS.stochastic;
  if (close <= bbLower) buyScore += INDICATOR_WEIGHTS.bollinger;
  if (close <= donchLower) buyScore += INDICATOR_WEIGHTS.donchian;
  if (williamsR < -80) buyScore += INDICATOR_WEIGHTS.williamsR;
  if ((fearGreed ?? 0) < 40) buyScore += INDICATOR_WEIGHTS.fearGreed;
  if ((macdHistogram ?? 0) > 0) buyScore += INDICATOR_WEIGHTS.macd;
  if (close > (sma20 ?? Infinity)) buyScore += INDICATOR_WEIGHTS.sma;
  if (close > (ema20 ?? Infinity)) buyScore += INDICATOR_WEIGHTS.ema;
  buyScore += patternScore;

  let sellScore = 0;
  if (rsi > 70) sellScore += INDICATOR_WEIGHTS.rsi;
  if (stochasticK > 80) sellScore += INDICATOR_WEIGHTS.stochastic;
  if (close >= bbUpper) sellScore += INDICATOR_WEIGHTS.bollinger;
  if (close >= donchUpper) sellScore += INDICATOR_WEIGHTS.donchian;
  if (williamsR > -20) sellScore += INDICATOR_WEIGHTS.williamsR;
  if ((fearGreed ?? 0) > 60) sellScore += INDICATOR_WEIGHTS.fearGreed;
  if ((macdHistogram ?? 0) < 0) sellScore += INDICATOR_WEIGHTS.macd;
  if (close < (sma20 ?? -Infinity)) sellScore += INDICATOR_WEIGHTS.sma;
  if (close < (ema20 ?? -Infinity)) sellScore += INDICATOR_WEIGHTS.ema;

  const effectiveBuyThreshold = buyThreshold ?? BUY_THRESHOLD;
  const effectiveSellThreshold = sellThreshold ?? SELL_THRESHOLD;

  if (buyScore >= effectiveBuyThreshold && buyScore >= sellScore) {
    return { decision: 'BUY', score: buyScore };
  }
  if (sellScore >= effectiveSellThreshold && sellScore > buyScore) {
    return { decision: 'SELL', score: sellScore };
  }
  return { decision: 'HOLD', score: Math.max(buyScore, sellScore) };
}
