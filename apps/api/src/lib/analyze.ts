import {
  DEFAULT_QUALITY_PIPELINE_CONFIG,
  MARKET_BENCHMARK,
  SECTOR_ETF_MAP,
} from '@stock-checker/core/src/constants';
import { TICKER_SECTOR_ETF } from '@stock-checker/core/src/constants/tickers';
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
import { calculateLongRiskLevels } from '@stock-checker/core/src/services/risk-levels';
import type { CandleData, PipelineConfig, TickerResult } from '@stock-checker/core/src/types/index';
import { tradingDaysUntil } from '@stock-checker/core/src/utils/trading-days';

/**
 * Use the documented institutional-flow and leader-pullback rules.
 * Historical performance needs revalidation after the execution and data fixes
 * described in docs/TRADING_PRINCIPLES.md. Optimizer overrides are not mixed in.
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
  const riskLevels = calculateLongRiskLevels(latest.close, indicators.atr);
  if (!riskLevels) return null;

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
  // and current earnings revision direction (historical backtests omit unavailable
  // point-in-time earnings data; without the benchmark inputs
  // rsSpy/rsSector stay 0 and the leader-pullback gate would block everything).
  const spyCandles = await fetchBenchmarkPrices(MARKET_BENCHMARK);
  let sectorETF: string | null = TICKER_SECTOR_ETF[ticker] ?? null;
  let sector: string | null = null;
  try {
    const fund = await getFundamentals(ticker);
    sector = fund?.sector ?? null;
    if (fund?.sector && SECTOR_ETF_MAP[fund.sector]) {
      sectorETF = SECTOR_ETF_MAP[fund.sector];
    }
  } catch {
    /* retain the known ticker-sector mapping, or leave sector evidence unavailable */
  }
  const sectorCandles = sectorETF ? await fetchBenchmarkPrices(sectorETF) : [];

  const recent20 = dailyPrices.slice(-20);
  const avgDailyDollarVol =
    recent20.reduce((s, d) => s + (d.dollarVolume ?? d.close * d.volume), 0) / recent20.length;

  let earningsBeat: boolean | null = null;
  let earningsEstimateUp: boolean | null = null;
  let nextEarningsDate: Date | null = null;
  try {
    const earningsInfo = await getEarningsData(ticker);
    nextEarningsDate = earningsInfo?.nextEarningsDate ?? null;
    const revisionDirection = earningsInfo?.estimateRevisions?.direction;
    earningsEstimateUp =
      revisionDirection === 'up' ? true : revisionDirection === 'down' ? false : null;
    const hist = earningsInfo?.earningsHistory;
    if (hist && hist.length > 0) {
      const last = hist[hist.length - 1];
      if (last.epsActual != null && last.epsEstimate != null) {
        earningsBeat = last.epsActual > last.epsEstimate;
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
    // Alternative.me measures Bitcoin sentiment, not US equity sentiment.
    fearGreed: null,
    patternScore,
    recentCandles,
    recentMacdHistogram,
    config: pipelineConfig,
    allCloses: closes,
    allDates: dailyPrices.map((d) => d.date),
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
    ...riskLevels,
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
    sector,
    nextEarningsDate: nextEarningsDate ? nextEarningsDate.toISOString().split('T')[0] : null,
    daysToEarnings: nextEarningsDate ? tradingDaysUntil(nextEarningsDate) : null,
  };
}
