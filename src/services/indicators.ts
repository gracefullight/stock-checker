import { atr, bollingerbands, MACD, rsi, stochastic, williamsr } from 'technicalindicators';
import type { IndicatorValues } from '@/types';

interface MacdResult {
  MACD?: number;
  signal?: number;
  histogram?: number;
}

export function calculateAllIndicators(data: {
  closes: number[];
  highs: number[];
  lows: number[];
}): IndicatorValues {
  const { closes, highs, lows } = data;

  const rsiValues = rsi({ values: closes, period: 14 });
  const latestRsi = rsiValues[rsiValues.length - 1];

  const stochValues = stochastic({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
    signalPeriod: 3,
  });
  const latestStoch = stochValues[stochValues.length - 1];

  const bbValues = bollingerbands({ period: 20, values: closes, stdDev: 2 });
  const latestBb = bbValues[bbValues.length - 1];

  const williamsValues = williamsr({ high: highs, low: lows, close: closes, period: 14 });
  const latestWilliams = williamsValues[williamsValues.length - 1];

  const atrValues = atr({ high: highs, low: lows, close: closes, period: 14 });
  const latestAtr = atrValues[atrValues.length - 1];

  const donchPeriod = 20;
  const recentHighs = highs.slice(-donchPeriod);
  const recentLows = lows.slice(-donchPeriod);
  const donchUpper = Math.max(...recentHighs);
  const donchLower = Math.min(...recentLows);

  // Calculate SMA (20-day Simple Moving Average)
  const smaPeriod = 20;
  const recentClosesSMA = closes.slice(-smaPeriod);
  const sma20 = recentClosesSMA.reduce((sum, price) => sum + price, 0) / smaPeriod;

  // Calculate EMA (20-day Exponential Moving Average)
  const emaPeriod = 20;
  const emaK = 2 / (emaPeriod + 1);
  let ema20 = closes[emaPeriod - 1];
  for (let i = emaPeriod; i < closes.length; i++) {
    ema20 = closes[i] * emaK + ema20 * (1 - emaK);
  }

  // Calculate MACD (12, 26, 9)
  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: true,
    SimpleMASignal: true,
  });
  const latestMacd = macdValues[macdValues.length - 1] as MacdResult | undefined;

  const macdValue = latestMacd?.MACD ?? 0;
  const macdSignalValue = latestMacd?.signal ?? 0;
  const macdHistogramValue = macdValue - macdSignalValue;

  return {
    rsi: latestRsi ?? 50,
    stochasticK: latestStoch?.k ?? 50,
    bbLower: latestBb?.lower ?? 0,
    bbUpper: latestBb?.upper ?? 0,
    donchLower: donchLower ?? 0,
    donchUpper: donchUpper ?? 0,
    williamsR: latestWilliams ?? -50,
    atr: latestAtr ?? 0,
    macd: macdValue,
    macdSignal: macdSignalValue,
    macdHistogram: macdHistogramValue,
    sma20: Number.isNaN(sma20) ? 0 : sma20,
    ema20: Number.isNaN(ema20) ? 0 : ema20,
  };
}
