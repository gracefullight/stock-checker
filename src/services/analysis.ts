import type { IndicatorValues, PipelineConfig } from '@/types';

// --- Pipeline V2: Gradient Scoring ---

export function linearGradient(value: number, max: number, mid: number, zero: number): number {
  if (max < zero) {
    // Normal direction: lower value = stronger signal (e.g., RSI oversold)
    if (value <= max) return 1.0;
    if (value >= zero) return 0.0;
    if (value <= mid) return 1.0 - ((value - max) / (mid - max)) * 0.5;
    return 0.5 * ((zero - value) / (zero - mid));
  }
  // Inverted direction: higher value = stronger signal (e.g., RSI overbought)
  if (value >= max) return 1.0;
  if (value <= zero) return 0.0;
  if (value >= mid) return 1.0 - ((max - value) / (max - mid)) * 0.5;
  return 0.5 * ((value - zero) / (mid - zero));
}

export function gradientScore(params: {
  indicators: IndicatorValues;
  close: number;
  fearGreed: number | null;
  patternScore: number;
  recentMacdHistogram: number[];
  config: PipelineConfig;
}): { buyScore: number; sellScore: number; gradients: Record<string, number> } {
  const { indicators, close, fearGreed, patternScore, recentMacdHistogram, config } = params;
  const { gradientRanges: gr, indicatorWeights: w } = config;

  // Buy-side gradients (oversold conditions)
  const rsiGrad = linearGradient(indicators.rsi, gr.rsi.max, gr.rsi.mid, gr.rsi.zero);
  const stochKGrad = linearGradient(
    indicators.stochasticK,
    gr.stochK.max,
    gr.stochK.mid,
    gr.stochK.zero,
  );
  const williamsRGrad = linearGradient(
    indicators.williamsR,
    gr.williamsR.max,
    gr.williamsR.mid,
    gr.williamsR.zero,
  );

  // Bollinger %B: (close - lower) / (upper - lower)
  const bbRange = indicators.bbUpper - indicators.bbLower;
  const bollingerPctB = bbRange > 0 ? (close - indicators.bbLower) / bbRange : 0.5;
  const bollingerGrad = linearGradient(
    bollingerPctB,
    gr.bollingerPctB.max,
    gr.bollingerPctB.mid,
    gr.bollingerPctB.zero,
  );

  // Donchian position: (close - lower) / (upper - lower)
  const donchRange = indicators.donchUpper - indicators.donchLower;
  const donchPosition = donchRange > 0 ? (close - indicators.donchLower) / donchRange : 0.5;
  const donchianGrad = linearGradient(donchPosition, 0, 0.25, 0.5);

  // MACD histogram: crossover detection with decay
  let macdGrad = 0;
  if (recentMacdHistogram.length >= 2) {
    const current = recentMacdHistogram[recentMacdHistogram.length - 1];
    const previous = recentMacdHistogram[recentMacdHistogram.length - 2];
    if (current > 0 && previous <= 0) {
      // Fresh positive crossover
      macdGrad = 1.0;
    } else if (current > 0) {
      // Sustained positive — find crossover point and decay
      let daysSinceCrossover = 0;
      for (let i = recentMacdHistogram.length - 2; i >= 0; i--) {
        if (recentMacdHistogram[i] <= 0) break;
        daysSinceCrossover++;
      }
      macdGrad = 1 / (1 + daysSinceCrossover);
    }
  }

  // SMA20/EMA20 alignment
  const aboveSma = close > indicators.sma20;
  const aboveEma = close > indicators.ema20;
  const maAlignment = aboveSma && aboveEma ? 1.0 : aboveSma || aboveEma ? 0.5 : 0.0;

  // Fear & Greed (binary, market-wide)
  const fearGreedGrad = (fearGreed ?? 50) < 40 ? 1.0 : 0.0;

  const gradients: Record<string, number> = {
    rsi: rsiGrad,
    stochK: stochKGrad,
    bollingerPctB: bollingerGrad,
    donchianPosition: donchianGrad,
    williamsR: williamsRGrad,
    macd: macdGrad,
  };

  const buyScore =
    rsiGrad * w.rsi +
    stochKGrad * w.stochastic +
    bollingerGrad * w.bollinger +
    donchianGrad * w.donchian +
    williamsRGrad * w.williamsR +
    macdGrad * w.macd +
    maAlignment * w.sma +
    fearGreedGrad * w.fearGreed +
    patternScore;

  // Sell-side gradients (overbought conditions — inverted ranges)
  const rsiSellGrad = linearGradient(indicators.rsi, 85, 70, 60);
  const stochKSellGrad = linearGradient(indicators.stochasticK, 90, 80, 65);
  const williamsRSellGrad = linearGradient(indicators.williamsR, -10, -20, -40);
  const bollingerSellGrad = linearGradient(bollingerPctB, 1.0, 0.9, 0.7);
  const donchianSellGrad = linearGradient(donchPosition, 1.0, 0.75, 0.5);

  let macdSellGrad = 0;
  if (recentMacdHistogram.length >= 2) {
    const current = recentMacdHistogram[recentMacdHistogram.length - 1];
    const previous = recentMacdHistogram[recentMacdHistogram.length - 2];
    if (current < 0 && previous >= 0) {
      macdSellGrad = 1.0;
    } else if (current < 0) {
      let daysSinceCrossover = 0;
      for (let i = recentMacdHistogram.length - 2; i >= 0; i--) {
        if (recentMacdHistogram[i] >= 0) break;
        daysSinceCrossover++;
      }
      macdSellGrad = 1 / (1 + daysSinceCrossover);
    }
  }

  const belowSma = close < indicators.sma20;
  const belowEma = close < indicators.ema20;
  const maSellAlignment = belowSma && belowEma ? 1.0 : belowSma || belowEma ? 0.5 : 0.0;
  const fearGreedSellGrad = (fearGreed ?? 50) > 60 ? 1.0 : 0.0;

  const sellScore =
    rsiSellGrad * w.rsi +
    stochKSellGrad * w.stochastic +
    bollingerSellGrad * w.bollinger +
    donchianSellGrad * w.donchian +
    williamsRSellGrad * w.williamsR +
    macdSellGrad * w.macd +
    maSellAlignment * w.sma +
    fearGreedSellGrad * w.fearGreed;

  return { buyScore, sellScore, gradients };
}
