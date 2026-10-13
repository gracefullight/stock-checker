import { MARKET_BENCHMARK, sectorEtfFor } from '@/constants';
import {
  buildTickerContext,
  type Candle,
  evaluateLatestSignalWithContext,
} from '@/optimization/engine';
import {
  classifyProviderError,
  fetchBenchmarkPrices,
  getHistoricalPrices,
  MarketDataError,
  type MarketDataFailureCause,
} from '@/services/data-fetcher';
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
  SignalCheck,
  TickerResult,
} from '@/types';
import { isLeaderPullbackPipelineConfig, loadPipelineConfig } from '@/utils/config-loader';
import { tradingDaysUntil } from '@/utils/trading-days';

/** Sessions the shared causal evaluator needs before it can replay setup state. */
export const MIN_REPLAY_SESSIONS = 210;
const DEFAULT_LOOKBACK_DAYS = 730;

export interface EarningsEvidence {
  beat: boolean | null;
  estimateUp: boolean | null;
}

export interface TickerAnalysisContext {
  result: TickerResult;
  pipelineResult: PipelineResult;
  dailyPrices: Candle[];
  spyCandles: BenchmarkCandle[];
  sectorCandles: BenchmarkCandle[];
  sectorETF: string | null;
  config: PipelineConfig;
  /** Live provider earnings evidence; context only, never part of the decision. */
  earningsEvidence?: EarningsEvidence;
}

export type TickerAnalysisUnavailableCode =
  | 'history-unavailable'
  | 'invalid-price-or-atr'
  | 'risk-levels-infeasible'
  /** SPY or the sector ETF series is missing, short, or lacks the ticker's latest session. */
  | 'benchmark-unavailable'
  /** No sector ETF resolves for the ticker (unknown provider sector, outside the universe). */
  | 'sector-benchmark-unavailable'
  /** The ticker's latest completed session is older than SPY's latest completed session. */
  | 'stale-session';

export type TickerAnalysisUnavailableCause =
  | MarketDataFailureCause
  | 'missing-latest-session'
  | 'insufficient-bars'
  | 'unmapped-sector';

export interface TickerAnalysisUnavailable {
  code: TickerAnalysisUnavailableCode;
  rows: number;
  close?: number;
  atr?: number;
  /**
   * Why the input is unusable. Provider causes ('rate-limited' | 'empty' |
   * 'error') are reported after the Tiingo fallback also failed, so a screening
   * loop can pause on rate limits instead of counting HOLDs.
   */
  cause?: TickerAnalysisUnavailableCause;
  /** Benchmark symbol the failure refers to. */
  symbol?: string;
  /** Ticker's latest completed session (YYYY-MM-DD). */
  latestSession?: string;
  /** SPY's latest completed session (YYYY-MM-DD) when it is newer than the ticker's. */
  benchmarkSession?: string;
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

function sessionOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type BenchmarkOutcome =
  | { ok: true; candles: BenchmarkCandle[]; latestSession: string | null }
  | { ok: false; cause: TickerAnalysisUnavailableCause };

/**
 * Fetch a benchmark on the decision path. Provider failures surface with their
 * cause instead of degrading to an empty series; a series that lacks the ticker's
 * latest session or enough bars for the long RS lookback is equally unusable.
 */
async function loadBenchmark(
  symbol: string,
  lookbackDays: number,
  tickerSession: string,
  minBars: number
): Promise<BenchmarkOutcome> {
  let prices: BenchmarkCandle[];
  try {
    prices = await fetchBenchmarkPrices(symbol, lookbackDays, { strict: true });
  } catch (error) {
    return {
      ok: false,
      cause: error instanceof MarketDataError ? error.failure : classifyProviderError(error),
    };
  }
  if (prices.length === 0) return { ok: false, cause: 'empty' };
  const candles = prices.filter((candle) => sessionOf(candle.date) <= tickerSession);
  const last = candles.at(-1);
  if (!last || sessionOf(last.date) !== tickerSession) {
    return { ok: false, cause: 'missing-latest-session' };
  }
  if (candles.length <= minBars) return { ok: false, cause: 'insufficient-bars' };
  return { ok: true, candles, latestSession: sessionOf(prices[prices.length - 1].date) };
}

export async function analyzeTickerContext(
  ticker: string,
  fearGreed: number | null,
  options: TickerAnalysisOptions = {}
): Promise<TickerAnalysisContext | null> {
  const lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const dailyPrices = await getHistoricalPrices(ticker, lookbackDays);
  if (dailyPrices.length === 0) {
    emitUnavailable(options, { code: 'history-unavailable', rows: 0 });
    return null;
  }

  const latest = dailyPrices[dailyPrices.length - 1];
  const dateStr = sessionOf(latest.date);
  const rows = dailyPrices.length;
  const closes = dailyPrices.map((d) => d.close);
  const highs = dailyPrices.map((d) => d.high);
  const lows = dailyPrices.map((d) => d.low);
  const volumes = dailyPrices.map((d) => d.volume);

  let indicators = calculateAllIndicators({ closes, highs, lows, volumes });
  let riskLevels = calculateLongRiskLevels(latest.close, indicators.atr);
  if (!riskLevels) {
    reportUnavailableRisk(options, rows, latest.close, indicators.atr);
    return null;
  }
  if (options.pipelineConfig && !isLeaderPullbackPipelineConfig(options.pipelineConfig)) {
    throw new TypeError('Analysis requires a complete leader-pullback pipeline configuration');
  }
  const pipelineConfig = options.pipelineConfig
    ? structuredClone(options.pipelineConfig)
    : await loadPipelineConfig();

  // Benchmarks are decision inputs: the leader-pullback gate needs market and
  // sector relative strength on the ticker's own latest session. A missing,
  // short, or stale benchmark makes the analysis unavailable, never a HOLD.
  // The RS bar requirement only applies once the ticker itself has that history.
  const rsLookback = pipelineConfig.institutional.rsLookback.long;
  const minBenchmarkBars = rows > rsLookback ? rsLookback : 0;
  const spy = await loadBenchmark(MARKET_BENCHMARK, lookbackDays, dateStr, minBenchmarkBars);
  if (!spy.ok) {
    emitUnavailable(options, {
      code: 'benchmark-unavailable',
      rows,
      symbol: MARKET_BENCHMARK,
      cause: spy.cause,
      latestSession: dateStr,
    });
    return null;
  }
  if (spy.latestSession !== null && spy.latestSession > dateStr) {
    // The provider dropped or has not published the ticker's latest session. A
    // decision on the prior bar would label an entry "next open" one session late.
    emitUnavailable(options, {
      code: 'stale-session',
      rows,
      latestSession: dateStr,
      benchmarkSession: spy.latestSession,
    });
    return null;
  }
  const spyCandles = spy.candles;
  const marketUptrend =
    spyCandles.length >= 2
      ? gaussianChannel(spyCandles.map((candle) => candle.close)).isGreen
      : null;

  let sector: string | null = null;
  try {
    sector = (await getFundamentals(ticker))?.sector ?? null;
  } catch {
    /* sector evidence unavailable; the validated universe map may still resolve */
  }
  const sectorETF = sectorEtfFor(ticker, sector);
  if (!sectorETF) {
    emitUnavailable(options, {
      code: 'sector-benchmark-unavailable',
      rows,
      cause: 'unmapped-sector',
      latestSession: dateStr,
    });
    return null;
  }
  const sectorOutcome = await loadBenchmark(sectorETF, lookbackDays, dateStr, minBenchmarkBars);
  if (!sectorOutcome.ok) {
    emitUnavailable(options, {
      code: 'benchmark-unavailable',
      rows,
      symbol: sectorETF,
      cause: sectorOutcome.cause,
      latestSession: dateStr,
    });
    return null;
  }
  const sectorCandles = sectorOutcome.candles;

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

  const recent20 = dailyPrices.slice(-20);
  const avgDailyDollarVol =
    recent20.reduce((s, d) => s + (d.dollarVolume ?? d.close * d.volume), 0) / recent20.length;
  const nominalClose =
    latest.dollarVolume !== undefined && latest.volume > 0
      ? latest.dollarVolume / latest.volume
      : latest.close;

  // Live earnings evidence is context only. The validated measurement scored
  // every bar at the neutral earnings value (no point-in-time history exists),
  // so the decision below is made without it.
  const earningsEvidence: EarningsEvidence = { beat: null, estimateUp: null };
  let nextEarningsDate: Date | null = null;
  try {
    const earningsInfo = await getEarningsData(ticker);
    nextEarningsDate = earningsInfo?.nextEarningsDate ?? null;
    const revisionDirection = earningsInfo?.estimateRevisions?.direction;
    earningsEvidence.estimateUp =
      revisionDirection === 'up' ? true : revisionDirection === 'down' ? false : null;
    const hist = earningsInfo?.earningsHistory;
    if (hist && hist.length > 0) {
      const last = hist[hist.length - 1];
      if (last.epsActual != null && last.epsEstimate != null) {
        earningsEvidence.beat = last.epsActual > last.epsEstimate;
      }
    }
  } catch {
    /* earnings context unavailable */
  }

  const historicalContext = buildTickerContext(dailyPrices, spyCandles, sectorCandles);
  const replayed = historicalContext
    ? evaluateLatestSignalWithContext(historicalContext, ticker, pipelineConfig)
    : null;
  let pipelineResult: PipelineResult;
  if (replayed) {
    pipelineResult = replayed.pipelineResult;
    indicators = replayed.indicators;
    riskLevels = calculateLongRiskLevels(latest.close, indicators.atr);
    if (!riskLevels) {
      reportUnavailableRisk(options, rows, latest.close, indicators.atr);
      return null;
    }
  } else {
    // Fewer than MIN_REPLAY_SESSIONS sessions: no cluster state can be replayed,
    // so this path is unvalidated. Scores and gates are still reported for
    // context, but it never emits a BUY.
    const fallback = evaluateSignal({
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
      nominalClose,
      marketUptrend,
      currentDate: latest.date,
    });
    const historyCheck: SignalCheck = {
      gate: 'insufficient-history',
      id: 'sessions',
      passed: false,
      value: rows,
      limit: MIN_REPLAY_SESSIONS,
      comparator: '>=',
    };
    pipelineResult = {
      ...fallback,
      ...(fallback.finalDecision === 'BUY'
        ? { finalDecision: 'HOLD', score: fallback.buyScore, confidence: 0 }
        : {}),
      blockedBy: fallback.finalDecision === 'BUY' ? 'insufficient-history' : fallback.blockedBy,
      checks: [historyCheck, ...(fallback.checks ?? [])],
    };
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
    buyScore,
    sellScore,
    blockedBy: pipelineResult.blockedBy ?? null,
    checks: pipelineResult.checks ?? [],
    cluster: pipelineResult.cluster ?? null,
    earningsEvidence,
    sectorEtf: sectorETF,
  };
  return {
    result,
    pipelineResult,
    dailyPrices,
    spyCandles,
    sectorCandles,
    sectorETF,
    config: pipelineConfig,
    earningsEvidence,
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
