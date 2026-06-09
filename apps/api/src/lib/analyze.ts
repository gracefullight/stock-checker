import {
  DEFAULT_QUALITY_PIPELINE_CONFIG,
  MARKET_BENCHMARK,
  REWARD_MULTIPLIER,
  RISK_MULTIPLIER,
  SECTOR_ETF_MAP,
  TRAILING_ACTIVATION_MULTIPLIER,
  TRAILING_MULTIPLIER,
} from '@stock-checker/core/src/constants';
import {
  fetchBenchmarkPrices,
  getHistoricalPrices,
} from '@stock-checker/core/src/services/data-fetcher';
import { getEarningsData } from '@stock-checker/core/src/services/earnings';
import { getFundamentals } from '@stock-checker/core/src/services/fundamentals';
import {
  calcRecentMacdHistogram,
  calculateAllIndicators,
} from '@stock-checker/core/src/services/indicators';
import { detectPatterns } from '@stock-checker/core/src/services/patterns';
import { evaluateSignal } from '@stock-checker/core/src/services/pipeline';
import { calculateProbabilities } from '@stock-checker/core/src/services/probability';
import type { CandleData, PipelineConfig, TickerResult } from '@stock-checker/core/src/types/index';

/**
 * Live signal config = the backtest-validated quality pipeline, used VERBATIM.
 * (institutional flow strategy + Gaussian trend gate + leader-pullback quality
 * gate — 5-day WR 65.1% / R/R 1.36 vs 52.5% / 1.09 baseline; see
 * docs/TRADING_PRINCIPLES.md). Optimizer overrides are intentionally NOT mixed
 * in: they were fit for the momentum strategy and would deviate from the
 * validated behaviour.
 */
const pipelineConfig: PipelineConfig = { ...DEFAULT_QUALITY_PIPELINE_CONFIG };

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

  const { score: patternScore, patterns } = detectPatterns(
    { highs, lows, closes },
    pipelineConfig.patternWeights
  );

  const recentCandles: CandleData[] = dailyPrices.slice(-3).map((d) => ({
    open: d.open,
    close: d.close,
    high: d.high,
    low: d.low,
    volume: d.volume,
  }));

  const recentMacdHistogram = calcRecentMacdHistogram(closes);

  // Institutional flow inputs — market + sector relative strength, liquidity,
  // and earnings revision direction (mirrors the backtest feed; without these
  // rsSpy/rsSector stay 0 and the leader-pullback gate would block everything).
  const spyCandles = await fetchBenchmarkPrices(MARKET_BENCHMARK);
  let sectorETF = MARKET_BENCHMARK;
  try {
    const fund = await getFundamentals(ticker);
    if (fund?.sector && SECTOR_ETF_MAP[fund.sector]) {
      sectorETF = SECTOR_ETF_MAP[fund.sector];
    }
  } catch {
    /* fallback to SPY */
  }
  const sectorCandles = await fetchBenchmarkPrices(sectorETF);

  const recent20 = dailyPrices.slice(-20);
  const avgDailyDollarVol = recent20.reduce((s, d) => s + d.close * d.volume, 0) / recent20.length;

  let earningsBeat: boolean | null = null;
  let earningsEstimateUp: boolean | null = null;
  try {
    const earningsInfo = await getEarningsData(ticker);
    const hist = earningsInfo?.earningsHistory;
    if (hist && hist.length > 0) {
      const last = hist[hist.length - 1];
      if (last.epsActual != null && last.epsEstimate != null) {
        earningsBeat = last.epsActual > last.epsEstimate;
      }
      if (hist.length >= 2) {
        const prev = hist[hist.length - 2];
        if (last.epsEstimate != null && prev.epsEstimate != null) {
          earningsEstimateUp = last.epsEstimate > prev.epsEstimate;
        }
      }
    }
  } catch {
    /* fallback */
  }

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
    allCloses: closes,
    allHighs: highs,
    allLows: lows,
    allVolumes: volumes,
    spyCandles,
    sectorCandles,
    avgDailyDollarVol,
    earningsBeat,
    earningsEstimateUp,
  });

  const { finalDecision: decision, score, buyScore, sellScore } = pipelineResult;
  const probs = calculateProbabilities(buyScore, sellScore, pipelineConfig.calibration);

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
