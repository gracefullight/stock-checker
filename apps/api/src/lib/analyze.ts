import {
  DEFAULT_PIPELINE_CONFIG,
  REWARD_MULTIPLIER,
  RISK_MULTIPLIER,
  TRAILING_ACTIVATION_MULTIPLIER,
  TRAILING_MULTIPLIER,
} from '@stock-checker/core/src/constants';
import { getHistoricalPrices } from '@stock-checker/core/src/services/data-fetcher';
import {
  calcRecentMacdHistogram,
  calculateAllIndicators,
} from '@stock-checker/core/src/services/indicators';
import { detectPatterns } from '@stock-checker/core/src/services/patterns';
import { evaluateSignal } from '@stock-checker/core/src/services/pipeline';
import { calculateProbabilities } from '@stock-checker/core/src/services/probability';
import type { CandleData, PipelineConfig, TickerResult } from '@stock-checker/core/src/types/index';
import { loadOptimizedConfig } from '@stock-checker/core/src/utils/config-loader';

export async function analyzeTicker(
  ticker: string,
  fearGreed: number | null
): Promise<TickerResult | null> {
  const dailyPrices = await getHistoricalPrices(ticker, 730);
  if (dailyPrices.length === 0) {
    return null;
  }

  const latest = dailyPrices[dailyPrices.length - 1];
  const dateStr = latest.date.toISOString().split('T')[0];
  const closes = dailyPrices.map((d) => d.close);
  const highs = dailyPrices.map((d) => d.high);
  const lows = dailyPrices.map((d) => d.low);
  const volumes = dailyPrices.map((d) => d.volume);

  const indicators = calculateAllIndicators({ closes, highs, lows, volumes });
  const optimizedConfig = await loadOptimizedConfig();

  const { score: patternScore, patterns } = detectPatterns(
    { highs, lows, closes },
    optimizedConfig.patternWeights
  );

  const pipelineConfig: PipelineConfig = {
    ...DEFAULT_PIPELINE_CONFIG,
    indicatorWeights: optimizedConfig.weights as PipelineConfig['indicatorWeights'],
    thresholds: optimizedConfig.thresholds,
    patternWeights: optimizedConfig.patternWeights,
    calibration: optimizedConfig.calibration,
    ...(optimizedConfig.trendGate && { trendGate: optimizedConfig.trendGate }),
    ...(optimizedConfig.gradientRanges && { gradientRanges: optimizedConfig.gradientRanges }),
    ...(optimizedConfig.confluence && { confluence: optimizedConfig.confluence }),
    ...(optimizedConfig.reversalConfirm && { reversalConfirm: optimizedConfig.reversalConfirm }),
  };

  const recentCandles: CandleData[] = dailyPrices.slice(-3).map((d) => ({
    open: d.open,
    close: d.close,
    high: d.high,
    low: d.low,
    volume: d.volume,
  }));

  const recentMacdHistogram = calcRecentMacdHistogram(closes);

  const pipelineResult = evaluateSignal({
    ticker,
    indicators,
    close: latest.close,
    open: latest.open,
    fearGreed,
    patternScore,
    recentCandles,
    recentMacdHistogram,
    config: pipelineConfig,
  });

  const { finalDecision: decision, score, buyScore, sellScore } = pipelineResult;
  const probs = calculateProbabilities(buyScore, sellScore, optimizedConfig.calibration);

  const risk = indicators.atr * RISK_MULTIPLIER;
  const reward = risk * REWARD_MULTIPLIER;
  const direction = decision === 'SELL' ? -1 : 1;
  const stopLoss = latest.close - risk * direction;
  const takeProfit = latest.close + reward * direction;
  const trailingCandidate = latest.close - TRAILING_MULTIPLIER * indicators.atr * direction;
  const trailingStop =
    direction === 1 ? Math.min(stopLoss, trailingCandidate) : Math.max(stopLoss, trailingCandidate);
  const trailingStart = latest.close + TRAILING_ACTIVATION_MULTIPLIER * indicators.atr * direction;

  return {
    ticker,
    date: dateStr,
    close: latest.close,
    volume: latest.volume,
    rsi: indicators.rsi,
    stochasticK: indicators.stochasticK,
    bbLower: indicators.bbLower,
    bbUpper: indicators.bbUpper,
    donchLower: indicators.donchLower,
    donchUpper: indicators.donchUpper,
    williamsR: indicators.williamsR,
    fearGreed,
    patterns,
    score,
    opinion: decision,
    atr: indicators.atr,
    stopLoss,
    takeProfit,
    trailingStop,
    trailingStart,
    macd: indicators.macd,
    macdSignal: indicators.macdSignal,
    macdHistogram: indicators.macdHistogram,
    sma20: indicators.sma20,
    ema20: indicators.ema20,
    buyProbability: probs.buyProbability,
    sellProbability: probs.sellProbability,
    holdProbability: probs.holdProbability,
    confidence: probs.confidence,
    sma50: indicators.sma50,
    sma200: indicators.sma200,
    volumeRatio: indicators.volumeRatio,
    trendRegime: pipelineResult.gateResults.trend.regime,
    confluenceRatio: pipelineResult.gateResults.confluence.ratio,
  };
}
