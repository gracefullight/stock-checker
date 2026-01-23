import { rsi, stochastic, bollingerbands, williamsr, atr } from 'technicalindicators';
import type { IndicatorValues } from '../types';

export function calculateAllIndicators(data: {
  closes: number[];
  highs: number[];
  lows: number[];
}): IndicatorValues {
  const { closes, highs, lows } = data;

  const rsiValues = rsi({ values: closes, period: 14 });
  const latestRsi = rsiValues[rsiValues.length - 1];

  const stochValues = stochastic({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
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

  return {
    rsi: latestRsi,
    stochasticK: latestStoch.k,
    bbLower: latestBb.lower,
    bbUpper: latestBb.upper,
    donchLower,
    donchUpper,
    williamsR: latestWilliams,
    atr: latestAtr,
  };
}