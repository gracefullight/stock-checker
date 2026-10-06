import { MARKET_BENCHMARK, SECTOR_ETF_MAP } from '@/constants';
import { TICKER_SECTOR_ETF } from '@/constants/tickers';
import {
  buildTickerContext,
  type Candle,
  evaluateLatestSignalWithContext,
} from '@/optimization/engine';
import { fetchBenchmarkPrices, getHistoricalPrices } from '@/services/data-fetcher';
import { getEarningsData } from '@/services/earnings';
import { getFundamentals } from '@/services/fundamentals';
import { gaussianChannel } from '@/services/gaussian-channel';
import { calcRecentMacdHistogram, calculateAllIndicators } from '@/services/indicators';
import { detectPatterns } from '@/services/patterns';
import { evaluateSignal } from '@/services/pipeline';
import { calculateProbabilities } from '@/services/probability';
import { calculateLongRiskLevels } from '@/services/risk-levels';
import type {
  BenchmarkCandle,
  CandleData,
  PipelineConfig,
  PipelineResult,
  TickerResult,
} from '@/types';
import { isLeaderPullbackPipelineConfig, loadPipelineConfig } from '@/utils/config-loader';
import { tradingDaysUntil } from '@/utils/trading-days';

export interface TickerAnalysisContext {
  result: TickerResult;
  pipelineResult: PipelineResult;
  dailyPrices: Candle[];
  spyCandles: BenchmarkCandle[];
  sectorCandles: BenchmarkCandle[];
  sectorETF: string | null;
  config: PipelineConfig;
}

export type TickerAnalysisUnavailableCode =
  | 'history-unavailable'
  | 'invalid-price-or-atr'
  | 'risk-levels-infeasible';

export interface TickerAnalysisUnavailable {
  code: TickerAnalysisUnavailableCode;
  rows: number;
  close?: number;
  atr?: number;
}

export interface TickerAnalysisOptions {
  lookbackDays?: number;
  /** Internal caller-owned snapshot used by cache keys and multi-ticker runs. */
  pipelineConfig?: PipelineConfig;
  /** Safe diagnostics for an analysis that still returns null. */
  onUnavailable?: (reason: TickerAnalysisUnavailable) => void;
}

function emitUnavailable(options: TickerAnalysisOptions, reason: TickerAnalysisUnavailable): void {
  try {
    options.onUnavailable?.(reason);
  } catch {
    // Diagnostic consumers must not change the null analysis outcome.
  }
}

function reportUnavailableRisk(
  options: TickerAnalysisOptions,
  rows: number,
  close: number,
  atr: number
): void {
  const validInputs = Number.isFinite(close) && close > 0 && Number.isFinite(atr) && atr > 0;
  emitUnavailable(options, {
    code: validInputs ? 'risk-levels-infeasible' : 'invalid-price-or-atr',
    rows,
    ...(Number.isFinite(close) ? { close } : {}),
    ...(Number.isFinite(atr) ? { atr } : {}),
  });
}

export async function analyzeTickerContext(
  ticker: string,
  fearGreed: number | null,
  options: TickerAnalysisOptions = {}
): Promise<TickerAnalysisContext | null> {
  const dailyPrices = await getHistoricalPrices(ticker, options.lookbackDays ?? 730);
  if (dailyPrices.length === 0) {
    emitUnavailable(options, { code: 'history-unavailable', rows: 0 });
    return null;
  }

  const latest = dailyPrices[dailyPrices.length - 1];
  const dateStr = latest.date.toISOString().split('T')[0];
  const closes = dailyPrices.map((d) => d.close);
  const highs = dailyPrices.map((d) => d.high);
  const lows = dailyPrices.map((d) => d.low);
  const volumes = dailyPrices.map((d) => d.volume);

  let indicators = calculateAllIndicators({ closes, highs, lows, volumes });
  let riskLevels = calculateLongRiskLevels(latest.close, indicators.atr);
  if (!riskLevels) {
    reportUnavailableRisk(options, dailyPrices.length, latest.close, indicators.atr);
    return null;
  }
  if (options.pipelineConfig && !isLeaderPullbackPipelineConfig(options.pipelineConfig)) {
    throw new TypeError('Analysis requires a complete leader-pullback pipeline configuration');
  }
  const pipelineConfig = options.pipelineConfig
    ? structuredClone(options.pipelineConfig)
    : await loadPipelineConfig();

  const { score: patternScore, patterns: detectedPatterns } = detectPatterns(
    { highs: highs.slice(-50), lows: lows.slice(-50), closes: closes.slice(-50) },
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
  const spyPrices =
    options.lookbackDays === undefined
      ? await fetchBenchmarkPrices(MARKET_BENCHMARK)
      : await fetchBenchmarkPrices(MARKET_BENCHMARK, options.lookbackDays);
  const spyCandles = spyPrices.filter(
    (candle) => candle.date.toISOString().slice(0, 10) <= dateStr
  );
  const marketUptrend =
    spyCandles.length >= 2
      ? gaussianChannel(spyCandles.map((candle) => candle.close)).isGreen
      : null;
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
  const sectorPrices = sectorETF
    ? options.lookbackDays === undefined
      ? await fetchBenchmarkPrices(sectorETF)
      : await fetchBenchmarkPrices(sectorETF, options.lookbackDays)
    : [];
  const sectorCandles = sectorPrices.filter(
    (candle) => candle.date.toISOString().slice(0, 10) <= dateStr
  );

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

  const historicalContext = buildTickerContext(dailyPrices, spyCandles, sectorCandles);
  const replayed = historicalContext
    ? evaluateLatestSignalWithContext(historicalContext, ticker, pipelineConfig, {
        earningsBeat,
        earningsEstimateUp,
      })
    : null;
  const pipelineResult =
    replayed?.pipelineResult ??
    evaluateSignal({
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
      marketUptrend,
      currentDate: latest.date,
    });
  if (replayed) {
    indicators = replayed.indicators;
    riskLevels = calculateLongRiskLevels(latest.close, indicators.atr);
    if (!riskLevels) {
      reportUnavailableRisk(options, dailyPrices.length, latest.close, indicators.atr);
      return null;
    }
  }
  const patterns = replayed?.patterns ?? detectedPatterns;

  const { finalDecision: decision, score, buyScore, sellScore } = pipelineResult;
  const probs = calculateProbabilities(buyScore, sellScore, pipelineConfig.calibration);

  const result: TickerResult = {
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
    institutionalScore: pipelineResult.gateResults.institutional.score,
    institutionalPassed: pipelineResult.gateResults.institutional.passed,
    sector,
    nextEarningsDate: nextEarningsDate ? nextEarningsDate.toISOString().split('T')[0] : null,
    daysToEarnings: nextEarningsDate ? tradingDaysUntil(nextEarningsDate) : null,
  };
  return {
    result,
    pipelineResult,
    dailyPrices,
    spyCandles,
    sectorCandles,
    sectorETF,
    config: pipelineConfig,
  };
}

/** Compatibility projection shared by the API and report consumers. */
export async function analyzeTicker(
  ticker: string,
  fearGreed: number | null,
  options: TickerAnalysisOptions = {}
): Promise<TickerResult | null> {
  return (await analyzeTickerContext(ticker, fearGreed, options))?.result ?? null;
}
