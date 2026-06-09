import type { IndicatorValues, PipelineConfig } from '@/types';

// --- Shared Utilities ---

export function linearGradient(value: number, max: number, mid: number, zero: number): number {
  if (max < zero) {
    // Normal direction: lower value = stronger signal (e.g., RSI oversold)
    if (value <= max) return 1.0;
    if (value >= zero) return 0.0;
    if (value <= mid) return 1.0 - ((value - max) / (mid - max)) * 0.5;
    return 0.5 * ((zero - value) / (zero - mid));
  }
  // Inverted direction: higher value = stronger signal (e.g., RSI momentum zone)
  if (value >= max) return 1.0;
  if (value <= zero) return 0.0;
  if (value >= mid) return 1.0 - ((max - value) / (max - mid)) * 0.5;
  return 0.5 * ((value - zero) / (mid - zero));
}

function macdCrossoverGrad(
  recentMacdHistogram: number[],
  direction: 'positive' | 'negative'
): number {
  if (recentMacdHistogram.length < 2) return 0;
  const current = recentMacdHistogram[recentMacdHistogram.length - 1];
  const previous = recentMacdHistogram[recentMacdHistogram.length - 2];
  const isFresh =
    direction === 'positive' ? current > 0 && previous <= 0 : current < 0 && previous >= 0;
  const isActive = direction === 'positive' ? current > 0 : current < 0;
  if (isFresh) return 1.0;
  if (isActive) {
    let days = 0;
    for (let i = recentMacdHistogram.length - 2; i >= 0; i--) {
      const v = recentMacdHistogram[i];
      if (direction === 'positive' ? v <= 0 : v >= 0) break;
      days++;
    }
    return 1 / (1 + days);
  }
  return 0;
}

// --- Mean Reversion Scoring (strategy: 'mean-reversion') ---

function meanReversionGradientScore(params: {
  indicators: IndicatorValues;
  close: number;
  fearGreed: number | null;
  patternScore: number;
  recentMacdHistogram: number[];
  config: PipelineConfig;
}): { buyScore: number; sellScore: number; gradients: Record<string, number> } {
  const { indicators, close, fearGreed, patternScore, recentMacdHistogram, config } = params;
  const { gradientRanges: gr, indicatorWeights: w } = config;

  const rsiGrad = linearGradient(indicators.rsi, gr.rsi.max, gr.rsi.mid, gr.rsi.zero);
  const stochKGrad = linearGradient(
    indicators.stochasticK,
    gr.stochK.max,
    gr.stochK.mid,
    gr.stochK.zero
  );
  const williamsRGrad = linearGradient(
    indicators.williamsR,
    gr.williamsR.max,
    gr.williamsR.mid,
    gr.williamsR.zero
  );

  const bbRange = indicators.bbUpper - indicators.bbLower;
  const bollingerPctB = bbRange > 0 ? (close - indicators.bbLower) / bbRange : 0.5;
  const bollingerGrad = linearGradient(
    bollingerPctB,
    gr.bollingerPctB.max,
    gr.bollingerPctB.mid,
    gr.bollingerPctB.zero
  );

  const donchRange = indicators.donchUpper - indicators.donchLower;
  const donchPosition = donchRange > 0 ? (close - indicators.donchLower) / donchRange : 0.5;
  const donchianGrad = linearGradient(donchPosition, 0, 0.25, 0.5);

  const macdGrad = macdCrossoverGrad(recentMacdHistogram, 'positive');

  const aboveSma = close > indicators.sma20;
  const aboveEma = close > indicators.ema20;
  const maAlignment = aboveSma && aboveEma ? 1.0 : aboveSma || aboveEma ? 0.5 : 0.0;
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

  const rsiSellGrad = linearGradient(indicators.rsi, 85, 70, 60);
  const stochKSellGrad = linearGradient(indicators.stochasticK, 90, 80, 65);
  const williamsRSellGrad = linearGradient(indicators.williamsR, -10, -20, -40);
  const bollingerSellGrad = linearGradient(bollingerPctB, 1.0, 0.9, 0.7);
  const donchianSellGrad = linearGradient(donchPosition, 1.0, 0.75, 0.5);
  const macdSellGrad = macdCrossoverGrad(recentMacdHistogram, 'negative');
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

// --- Momentum / Institutional Accumulation Scoring (strategy: 'momentum') ---

function momentumGradientScore(params: {
  indicators: IndicatorValues;
  close: number;
  fearGreed: number | null;
  patternScore: number;
  recentMacdHistogram: number[];
  config: PipelineConfig;
}): { buyScore: number; sellScore: number; gradients: Record<string, number> } {
  const { indicators, close, fearGreed, patternScore, recentMacdHistogram, config } = params;
  const { gradientRanges: gr, indicatorWeights: w } = config;
  const volumeWeight = w.volume ?? 90;

  // Oscillators tuned for momentum zone (inverted: higher reading = better)
  const rsiGrad = linearGradient(indicators.rsi, gr.rsi.max, gr.rsi.mid, gr.rsi.zero);
  const stochKGrad = linearGradient(
    indicators.stochasticK,
    gr.stochK.max,
    gr.stochK.mid,
    gr.stochK.zero
  );
  const williamsRGrad = linearGradient(
    indicators.williamsR,
    gr.williamsR.max,
    gr.williamsR.mid,
    gr.williamsR.zero
  );

  const bbRange = indicators.bbUpper - indicators.bbLower;
  const bollingerPctB = bbRange > 0 ? (close - indicators.bbLower) / bbRange : 0.5;
  // Near upper band = breakout territory
  const bollingerGrad = linearGradient(
    bollingerPctB,
    gr.bollingerPctB.max,
    gr.bollingerPctB.mid,
    gr.bollingerPctB.zero
  );

  // Near 20-day high = breakout zone
  const donchRange = indicators.donchUpper - indicators.donchLower;
  const donchPosition = donchRange > 0 ? (close - indicators.donchLower) / donchRange : 0.5;
  const donchianGrad = linearGradient(donchPosition, 1.0, 0.75, 0.5);

  const macdGrad = macdCrossoverGrad(recentMacdHistogram, 'positive');

  // Full MA alignment: each of close>sma200, close>sma50, sma50>sma200, close>sma20
  let maAlignCount = 0;
  if (!Number.isNaN(indicators.sma200) && close > indicators.sma200) maAlignCount++;
  if (!Number.isNaN(indicators.sma50) && close > indicators.sma50) maAlignCount++;
  if (
    !Number.isNaN(indicators.sma50) &&
    !Number.isNaN(indicators.sma200) &&
    indicators.sma50 > indicators.sma200
  )
    maAlignCount++;
  if (close > indicators.sma20) maAlignCount++;
  const maAlignment = maAlignCount / 4;

  // Volume: institutional accumulation footprint
  const volGrad =
    indicators.volumeRatio >= 3.0
      ? 1.0
      : indicators.volumeRatio >= 2.0
        ? 0.75
        : indicators.volumeRatio >= 1.5
          ? 0.5
          : indicators.volumeRatio >= 1.0
            ? 0.15
            : 0;

  // Market fear = buying opportunity within an uptrend
  const fearGreedGrad = (fearGreed ?? 50) < 30 ? 1.0 : (fearGreed ?? 50) < 40 ? 0.5 : 0.0;

  const gradients: Record<string, number> = {
    rsi: rsiGrad,
    stochK: stochKGrad,
    bollingerPctB: bollingerGrad,
    donchianPosition: donchianGrad,
    williamsR: williamsRGrad,
    macd: macdGrad,
    maAlignment,
    volumeRatio: volGrad,
  };

  const buyScore =
    rsiGrad * w.rsi +
    stochKGrad * w.stochastic +
    bollingerGrad * w.bollinger +
    donchianGrad * w.donchian +
    williamsRGrad * w.williamsR +
    macdGrad * w.macd +
    maAlignment * w.sma +
    volGrad * volumeWeight +
    fearGreedGrad * w.fearGreed +
    patternScore;

  // Sell: momentum breakdown signals
  const rsiSellGrad = linearGradient(indicators.rsi, 90, 82, 75);
  const stochKSellGrad = linearGradient(indicators.stochasticK, 92, 85, 75);
  const williamsRSellGrad = linearGradient(indicators.williamsR, -5, -10, -20);
  const bollingerSellGrad = linearGradient(bollingerPctB, 1.1, 1.0, 0.85);
  const donchianSellGrad = linearGradient(donchPosition, 0.1, 0.25, 0.5);
  const macdSellGrad = macdCrossoverGrad(recentMacdHistogram, 'negative');

  let maSellCount = 0;
  if (!Number.isNaN(indicators.sma50) && close < indicators.sma50) maSellCount++;
  if (!Number.isNaN(indicators.sma200) && close < indicators.sma200) maSellCount++;
  if (
    !Number.isNaN(indicators.sma50) &&
    !Number.isNaN(indicators.sma200) &&
    indicators.sma50 < indicators.sma200
  )
    maSellCount++;
  if (close < indicators.sma20) maSellCount++;
  const maSellAlignment = maSellCount / 4;

  // Volume spike on breakdown = institutional distribution
  const volSellGrad = indicators.volumeRatio >= 2.0 && close < indicators.sma20 ? 0.8 : 0;

  const fearGreedSellGrad = (fearGreed ?? 50) > 75 ? 1.0 : (fearGreed ?? 50) > 60 ? 0.5 : 0.0;

  const sellScore =
    rsiSellGrad * w.rsi +
    stochKSellGrad * w.stochastic +
    bollingerSellGrad * w.bollinger +
    donchianSellGrad * w.donchian +
    williamsRSellGrad * w.williamsR +
    macdSellGrad * w.macd +
    maSellAlignment * w.sma +
    volSellGrad * volumeWeight +
    fearGreedSellGrad * w.fearGreed;

  return { buyScore, sellScore, gradients };
}

// --- Institutional / Flow-Primary Scoring (strategy: 'institutional') ---
//
// Weight budget (buy side, total theoretical max shown in parens):
//
//   FLOW components (sum of weights = 390):
//     relativeStrength  rsSpy + rsSector blended via institutionalScore  (weight 120)
//     vwap accumulation                                                   (weight  90)
//     breakout + relative-volume                                          (weight 110)
//     liquidity / dollar-vol quality                                      (weight  40)
//     earnings revision                                                   (weight  30)
//
//   OSCILLATOR "seasoning" (sum = 130):
//     RSI momentum zone                                                   (weight  40)
//     MACD crossover                                                       (weight  35)
//     Stochastic                                                           (weight  25)
//     Williams %R                                                          (weight  30)
//
// Total theoretical max buy score ≈ 520 (before pattern contribution).
// Threshold should be set proportionally lower than momentum to fire more frequently.
//
// Flow dominance test: a +1 unit change in any flow component contributes
// (component weight) vs oscillator max contribution = 25-40.  Flow components
// each dominate oscillators individually.

export interface InstitutionalFlowInputs {
  /** Raw institutional score component gradients (each in [0, 1]) */
  rsSpy: number;
  rsSector: number;
  vwap: number;
  breakoutVol: number;
  liquidity: number;
  earnings: number;
}

/**
 * Flow-primary gradient score for the 'institutional' strategy.
 * Oscillators are included at light confirmation weight only.
 */
function institutionalGradientScore(params: {
  indicators: IndicatorValues;
  close: number;
  fearGreed: number | null;
  patternScore: number;
  recentMacdHistogram: number[];
  config: PipelineConfig;
  flowInputs?: InstitutionalFlowInputs;
}): { buyScore: number; sellScore: number; gradients: Record<string, number> } {
  const { indicators, close, patternScore, recentMacdHistogram, flowInputs } = params;
  const { gradientRanges: gr } = params.config;

  // -- FLOW gradients (primary) --

  // rsSpy and rsSector: if provided from institutionalScore components, use them;
  // otherwise fall back to volume-proxy (cannot compute RS without benchmark series here)
  const rsSpyGrad = flowInputs?.rsSpy ?? 0;
  const rsSectorGrad = flowInputs?.rsSector ?? 0;
  const vwapGrad = flowInputs?.vwap ?? 0;
  const breakoutVolGrad = flowInputs?.breakoutVol ?? 0;
  const liquidityGrad = flowInputs?.liquidity ?? 0;
  const earningsGrad = flowInputs?.earnings ?? 0;

  // Flow component weights (primary — heavy)
  const W_RS_SPY = 120;
  const W_RS_SECTOR = 90; // slightly lower than SPY
  const W_VWAP = 90;
  const W_BREAKOUT_VOL = 110;
  const W_LIQUIDITY = 40;
  const W_EARNINGS = 30;

  // -- OSCILLATOR gradients (seasoning — light confirmation) --

  // RSI in momentum zone (higher reading = positive flow confirmation)
  const rsiGrad = linearGradient(indicators.rsi, gr.rsi.max, gr.rsi.mid, gr.rsi.zero);

  // MACD crossover (decay-based, same helper)
  const macdGrad = macdCrossoverGrad(recentMacdHistogram, 'positive');

  // Stochastic K in momentum zone
  const stochKGrad = linearGradient(
    indicators.stochasticK,
    gr.stochK.max,
    gr.stochK.mid,
    gr.stochK.zero
  );

  // Williams %R (momentum interpretation)
  const williamsRGrad = linearGradient(
    indicators.williamsR,
    gr.williamsR.max,
    gr.williamsR.mid,
    gr.williamsR.zero
  );

  // Oscillator weights (light — confirmation only)
  const W_RSI = 40;
  const W_MACD = 35;
  const W_STOCH = 25;
  const W_WILLIAMS = 30;

  const gradients: Record<string, number> = {
    rsSpy: rsSpyGrad,
    rsSector: rsSectorGrad,
    vwap: vwapGrad,
    breakoutVol: breakoutVolGrad,
    liquidity: liquidityGrad,
    earnings: earningsGrad,
    rsi: rsiGrad,
    macd: macdGrad,
    stochK: stochKGrad,
    williamsR: williamsRGrad,
  };

  const buyScore =
    // Flow (primary)
    rsSpyGrad * W_RS_SPY +
    rsSectorGrad * W_RS_SECTOR +
    vwapGrad * W_VWAP +
    breakoutVolGrad * W_BREAKOUT_VOL +
    liquidityGrad * W_LIQUIDITY +
    earningsGrad * W_EARNINGS +
    // Oscillators (seasoning)
    rsiGrad * W_RSI +
    macdGrad * W_MACD +
    stochKGrad * W_STOCH +
    williamsRGrad * W_WILLIAMS +
    // Pattern contribution unchanged
    patternScore;

  // Sell side: breakdown signals
  const bbRange = indicators.bbUpper - indicators.bbLower;
  const bollingerPctB = bbRange > 0 ? (close - indicators.bbLower) / bbRange : 0.5;
  const donchRange = indicators.donchUpper - indicators.donchLower;
  const donchPosition = donchRange > 0 ? (close - indicators.donchLower) / donchRange : 0.5;

  const rsiSellGrad = linearGradient(indicators.rsi, 90, 82, 75);
  const macdSellGrad = macdCrossoverGrad(recentMacdHistogram, 'negative');
  const bollingerSellGrad = linearGradient(bollingerPctB, 1.1, 1.0, 0.85);
  const donchianSellGrad = linearGradient(donchPosition, 0.1, 0.25, 0.5);
  // Flow reversal signals: price below vwap + high relative volume on downside
  const vwapSellGrad = vwapGrad < 0.3 && indicators.volumeRatio >= 1.5 ? 0.8 : 0;

  const sellScore =
    rsiSellGrad * W_RSI +
    macdSellGrad * W_MACD +
    bollingerSellGrad * 50 +
    donchianSellGrad * 50 +
    vwapSellGrad * W_VWAP;

  return { buyScore, sellScore, gradients };
}

// --- Public API ---

export { institutionalGradientScore };

export function gradientScore(params: {
  indicators: IndicatorValues;
  close: number;
  fearGreed: number | null;
  patternScore: number;
  recentMacdHistogram: number[];
  config: PipelineConfig;
  flowInputs?: InstitutionalFlowInputs;
}): { buyScore: number; sellScore: number; gradients: Record<string, number> } {
  if (params.config.strategy === 'institutional') {
    return institutionalGradientScore(params);
  }
  if (params.config.strategy === 'momentum') {
    return momentumGradientScore(params);
  }
  return meanReversionGradientScore(params);
}
