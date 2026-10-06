/**
 * Pure backtest engine — config-independent ticker context, signal generation,
 * and win-rate measurement, extracted VERBATIM from commands/backtest.ts so the
 * same code paths run in the CLI, the API, and the browser (Web Worker). No
 * I/O: callers inject candles and benchmark series.
 */
import {
  ATR,
  BollingerBands,
  EMA,
  MACD,
  RSI,
  SMA,
  Stochastic,
  WilliamsR,
} from 'technicalindicators';
import { DEFAULT_ROUND_TRIP_COST_PCT } from '@/constants';
import { type GaussianChannelPoint, gaussianChannel } from '@/services/gaussian-channel';
import { detectPatterns } from '@/services/patterns';
import { evaluateSignal } from '@/services/pipeline';
import type {
  BenchmarkCandle,
  CandleData,
  IndicatorValues,
  PipelineConfig,
  PipelineResult,
} from '@/types';

/** Daily OHLCV candle as consumed by the engine. */
export interface Candle {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
  /** Nominal source close × source volume; adjusted prices alone are not USD turnover. */
  dollarVolume?: number;
}

export type ExecutionCandle = Pick<Candle, 'date' | 'open' | 'close'>;

export interface EvaluationWindow {
  /** Inclusive entry-session bounds, after any indicator warmup. */
  start?: Date;
  end?: Date;
}

interface MacdPoint {
  MACD?: number;
  signal?: number;
  histogram?: number;
}

export interface BacktestSignal {
  date: Date;
  ticker: string;
  close: number;
  decision: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  regime: string;
  confluenceRatio: number;
  // Essay #1 (institutional flow) component gradients, each in [0, 1].
  rsSpy: number;
  rsSector: number;
  vwap: number;
  breakoutVol: number;
  rsi: number;
  stochK: number;
  williamsR: number;
  atr: number;
  volumeRatio: number;
  trendStrength: number;
  sma50dist: number;
  sma200dist: number;
  rsiDelta: number;
  priceDelta: number;
  ibs: number;
  rsi2cumul: number;
  atrDistance: number;
  consecutiveOversold: number;
}

export interface WinRateResult {
  winRate5d: number;
  totalSignals: number;
  wins: number;
  avgReturn: number;
  avgWin: number;
  avgLoss: number;
  rewardRisk: number;
  monthlyBreakdown: Record<string, { wins: number; total: number }>;
  signalsPerMonth: number;
  /** Average bars held per trade (fixed 5 for the 5-day metric). */
  avgHoldBars: number;
}

export function buildIndicatorsAtBar(
  _closes: number[],
  _highs: number[],
  _lows: number[],
  volumes: number[],
  rsiArr: number[],
  stochArr: { k: number; d: number }[],
  bbArr: { lower: number; upper: number; middle: number }[],
  sma20Arr: number[],
  ema20Arr: number[],
  sma50Arr: number[],
  sma200Arr: number[],
  williamsArr: number[],
  atrArr: number[],
  donchLowerArr: number[],
  donchUpperArr: number[],
  volMaArr: number[],
  i: number,
  macdArr: MacdPoint[] = []
): IndicatorValues | null {
  const rsiVal = rsiArr[i - 14];
  const stochVal = stochArr[i - 13];
  const bbVal = bbArr[i - 19];
  const sma20Val = sma20Arr[i - 19];
  const ema20Val = ema20Arr[i - 19];
  const sma50Val = sma50Arr[i - 49];
  const sma200Val = sma200Arr[i - 199];
  const williamsVal = williamsArr[i - 13];
  const macd = macdArr[i - 25];

  if (rsiVal == null || stochVal == null || bbVal == null || sma20Val == null || ema20Val == null) {
    return null;
  }

  return {
    rsi: rsiVal,
    stochasticK: stochVal.k,
    bbLower: bbVal.lower,
    bbUpper: bbVal.upper,
    donchLower: donchLowerArr[i],
    donchUpper: donchUpperArr[i],
    williamsR: williamsVal ?? -50,
    atr: atrArr[i],
    macd: macd?.MACD ?? 0,
    macdSignal: macd?.signal ?? 0,
    macdHistogram: (macd?.MACD ?? 0) - (macd?.signal ?? 0),
    sma20: sma20Val,
    ema20: ema20Val,
    sma50: sma50Val ?? NaN,
    sma200: sma200Val ?? NaN,
    volumeRatio: volMaArr[i] > 0 ? volumes[i] / volMaArr[i] : 1.0,
  };
}

export function alignBenchmark(bench: BenchmarkCandle[], data: { date: Date }[]): number[] {
  const idxForBar: number[] = new Array(data.length).fill(-1);
  if (bench.length === 0) return idxForBar;
  let bp = 0;
  for (let i = 0; i < data.length; i++) {
    while (bp + 1 < bench.length && bench[bp + 1].date.getTime() <= data[i].date.getTime()) bp++;
    idxForBar[i] = bench[bp].date.getTime() <= data[i].date.getTime() ? bp : -1;
  }
  return idxForBar;
}

/**
 * Per-ticker, CONFIG-INDEPENDENT precomputed context. Indicators, benchmark
 * alignment, and rolling dollar-volume do not depend on the pipeline config, so
 * they are computed ONCE per ticker and reused across every config pass (the
 * backtest runs ~140 passes). This is the single biggest backtest speedup and
 * needs no GPU — the work was simply being recomputed 140×.
 */
export interface TickerContext {
  data: Candle[];
  evaluationStart: Date;
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  spy: BenchmarkCandle[];
  sector: BenchmarkCandle[];
  spyIdxForBar: number[];
  sectorIdxForBar: number[];
  rsi2Arr: number[];
  rsiArr: number[];
  stochArr: { k: number; d: number }[];
  bbArr: { lower: number; upper: number; middle: number }[];
  sma20Arr: number[];
  ema20Arr: number[];
  sma50Arr: number[];
  sma200Arr: number[];
  williamsArr: number[];
  atrArr: number[];
  donchLowerArr: number[];
  donchUpperArr: number[];
  volMaArr: number[];
  macdHistArr: number[];
  macdArr: MacdPoint[];
  avgDollarVolArr: number[];
  gaussianSeries: GaussianChannelPoint[];
  /** SPY Gaussian Channel green per SPY bar (causal) — market-level regime. */
  spyUptrend: boolean[];
}

export function buildTickerContext(
  data: Candle[],
  spy: BenchmarkCandle[] = [],
  sector: BenchmarkCandle[] = []
): TickerContext | null {
  if (data.length < 210) return null;

  const closes = data.map((d) => d.close);
  const highs = data.map((d) => d.high);
  const lows = data.map((d) => d.low);
  const volumes = data.map((d) => d.volume);

  // Align benchmarks to each bar (last bench bar on/before the ticker bar) — no lookahead.
  const spyIdxForBar = alignBenchmark(spy, data);
  const sectorIdxForBar = alignBenchmark(sector, data);

  // Pre-compute indicators
  const rsi2Arr = RSI.calculate({ values: closes, period: 2 });
  const rsiArr = RSI.calculate({ values: closes, period: 14 });
  const stochArr = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
    signalPeriod: 3,
  }) as { k: number; d: number }[];
  const bbArr = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 }) as {
    lower: number;
    upper: number;
    middle: number;
  }[];
  const macdArr = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: true,
    SimpleMASignal: true,
  });
  const sma20Arr = SMA.calculate({ values: closes, period: 20 });
  const ema20Arr = EMA.calculate({ values: closes, period: 20 });
  const sma50Arr = SMA.calculate({ values: closes, period: 50 });
  const sma200Arr = SMA.calculate({ values: closes, period: 200 });
  const williamsArr = WilliamsR.calculate({ high: highs, low: lows, close: closes, period: 14 });

  // Wilder ATR, matching the live indicator service. The first output is bar 14.
  const atrArr = [
    ...new Array<number>(14).fill(0),
    ...ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }),
  ];

  // Donchian
  const donchLowerArr: number[] = [];
  const donchUpperArr: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 19) {
      donchLowerArr.push(lows[i]);
      donchUpperArr.push(highs[i]);
      continue;
    }
    donchLowerArr.push(Math.min(...lows.slice(i - 19, i + 1)));
    donchUpperArr.push(Math.max(...highs.slice(i - 19, i + 1)));
  }

  // Volume MA
  const volMaArr: number[] = [];
  for (let i = 0; i < volumes.length; i++) {
    if (i < 19) {
      volMaArr.push(volumes[i] || 1);
      continue;
    }
    volMaArr.push(volumes.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20);
  }

  // MACD histogram array
  const macdHistArr = macdArr.map((m) => {
    const mv = (m as { MACD?: number }).MACD ?? 0;
    const sv = (m as { signal?: number }).signal ?? 0;
    return mv - sv;
  });

  // Rolling 20-bar average dollar volume (config-independent) — O(n) once.
  const avgDollarVolArr: number[] = new Array(closes.length).fill(0);
  for (let i = 0; i < closes.length; i++) {
    const dvFrom = Math.max(0, i - 19);
    let dollarVolSum = 0;
    for (let k = dvFrom; k <= i; k++) {
      dollarVolSum += data[k].dollarVolume ?? data[k].close * data[k].volume;
    }
    avgDollarVolArr[i] = dollarVolSum / (i - dvFrom + 1);
  }

  // Gaussian Channel series — computed ONCE (causal filter ⇒ series[i] equals
  // recomputing on closes[0..i]). Removes the O(n²) per-bar recompute that
  // dominated the institutional/gaussian passes.
  const gaussianSeries = gaussianChannel(closes).series;

  // Market-level regime: SPY Gaussian green per SPY bar (same causal property).
  const spyUptrend =
    spy.length > 0 ? gaussianChannel(spy.map((c) => c.close)).series.map((p) => p.isGreen) : [];

  return {
    data,
    evaluationStart: data[206].date,
    closes,
    highs,
    lows,
    volumes,
    spy,
    sector,
    spyIdxForBar,
    sectorIdxForBar,
    rsi2Arr,
    rsiArr,
    stochArr,
    bbArr,
    sma20Arr,
    ema20Arr,
    sma50Arr,
    sma200Arr,
    williamsArr,
    atrArr,
    donchLowerArr,
    donchUpperArr,
    volMaArr,
    macdHistArr,
    macdArr,
    avgDollarVolArr,
    gaussianSeries,
    spyUptrend,
  };
}

/** Completed-bar analysis shared by the historical signal loop and live callers. */
export interface TickerBarEvaluation {
  index: number;
  indicators: IndicatorValues;
  patterns: ReturnType<typeof detectPatterns>['patterns'];
  pipelineResult: PipelineResult;
}

export interface CurrentEarningsEvidence {
  /** Current provider evidence applies only to the latest bar, never to older setup states. */
  earningsBeat?: boolean | null;
  earningsEstimateUp?: boolean | null;
}

/** Shared causal evaluation and setup consumption for historical and live decisions. */
function* evaluateBarsWithContext(
  ctx: TickerContext,
  ticker: string,
  config: PipelineConfig,
  latestEarnings: CurrentEarningsEvidence = {}
): Generator<TickerBarEvaluation> {
  const {
    data,
    closes,
    highs,
    lows,
    volumes,
    spy,
    sector,
    spyIdxForBar,
    sectorIdxForBar,
    rsiArr,
    stochArr,
    bbArr,
    sma20Arr,
    ema20Arr,
    sma50Arr,
    sma200Arr,
    williamsArr,
    atrArr,
    donchLowerArr,
    donchUpperArr,
    volMaArr,
    macdHistArr,
    macdArr,
    avgDollarVolArr,
    gaussianSeries,
  } = ctx;

  const recentBuyDates: Date[] = [];

  for (let i = 205; i < data.length; i++) {
    const indicators = buildIndicatorsAtBar(
      closes,
      highs,
      lows,
      volumes,
      rsiArr,
      stochArr,
      bbArr,
      sma20Arr,
      ema20Arr,
      sma50Arr,
      sma200Arr,
      williamsArr,
      atrArr,
      donchLowerArr,
      donchUpperArr,
      volMaArr,
      i,
      macdArr
    );
    if (!indicators) continue;

    const recentCandles: CandleData[] = [];
    for (let j = Math.max(0, i - 2); j <= i; j++) {
      recentCandles.push({
        open: data[j].open,
        close: data[j].close,
        high: data[j].high,
        low: data[j].low,
        volume: data[j].volume,
      });
    }

    const histStart = Math.max(0, i - 25 - 4);
    const histEnd = i - 25 + 1;
    const recentMacdHistogram = histEnd > 0 ? macdHistArr.slice(histStart, histEnd) : [0];

    // Detect chart patterns
    const pw = Math.min(i + 1, 50);
    const { score: patternScore, patterns } = detectPatterns(
      {
        highs: highs.slice(i - pw + 1, i + 1),
        lows: lows.slice(i - pw + 1, i + 1),
        closes: closes.slice(i - pw + 1, i + 1),
      },
      config.patternWeights
    );

    const spyIdx = spyIdxForBar[i];
    const spyCandles = spyIdx >= 0 ? spy.slice(0, spyIdx + 1) : [];
    const sectorIdx = sectorIdxForBar[i];
    const sectorCandles = sectorIdx >= 0 ? sector.slice(0, sectorIdx + 1) : [];
    const avgDailyDollarVol = avgDollarVolArr[i];

    const result = evaluateSignal({
      ticker,
      indicators,
      close: closes[i],
      open: data[i].open,
      fearGreed: null,
      patternScore,
      recentCandles,
      recentMacdHistogram,
      config,
      recentBuyDates,
      currentDate: data[i].date,
      // Institutional/flow inputs — series up to bar i (no lookahead) + market RS + liquidity.
      allCloses: closes.slice(0, i + 1),
      allHighs: highs.slice(0, i + 1),
      allLows: lows.slice(0, i + 1),
      allVolumes: volumes.slice(0, i + 1),
      allDates: data.slice(0, i + 1).map((bar) => bar.date),
      spyCandles,
      sectorCandles,
      avgDailyDollarVol,
      gaussianPoint: gaussianSeries[i],
      marketUptrend: spyIdx >= 0 ? (ctx.spyUptrend[spyIdx] ?? null) : null,
      ...(i === data.length - 1 ? latestEarnings : {}),
    });

    // Record BUYs and quality-blocked setups into the cluster window: a setup is
    // judged ONCE on its first score-fire; later bars of the same deteriorating
    // cluster must not re-trigger; live latest-bar analysis replays this same state.
    if (result.finalDecision === 'BUY' || result.qualityBlocked) {
      recentBuyDates.push(data[i].date);
    }

    yield { index: i, indicators, patterns, pipelineResult: result };
  }
}

/** Replay earlier setups, then evaluate the completed latest bar with its current evidence. */
export function evaluateLatestSignalWithContext(
  ctx: TickerContext,
  ticker: string,
  config: PipelineConfig,
  latestEarnings: CurrentEarningsEvidence = {}
): TickerBarEvaluation | null {
  let latest: TickerBarEvaluation | null = null;
  for (const evaluation of evaluateBarsWithContext(ctx, ticker, config, latestEarnings)) {
    latest = evaluation;
  }
  return latest?.index === ctx.data.length - 1 ? latest : null;
}

/** Run the config-dependent signal loop using the same evaluator as live analysis. */
export function runSignalsWithContext(
  ctx: TickerContext,
  ticker: string,
  config: PipelineConfig
): BacktestSignal[] {
  const { data, closes, highs, lows, rsi2Arr, rsiArr } = ctx;
  const signals: BacktestSignal[] = [];
  for (const { index: i, indicators, pipelineResult: result } of evaluateBarsWithContext(
    ctx,
    ticker,
    config
  )) {
    if (result.finalDecision !== 'HOLD') {
      signals.push({
        date: data[i].date,
        ticker,
        close: closes[i],
        decision: result.finalDecision,
        score: result.score,
        regime: result.gateResults.trend.regime,
        confluenceRatio: result.gateResults.confluence.ratio,
        rsSpy: result.gateResults.institutional.components.rsSpy,
        rsSector: result.gateResults.institutional.components.rsSector,
        vwap: result.gateResults.institutional.components.vwap,
        breakoutVol: result.gateResults.institutional.components.breakoutVol,
        rsi: indicators.rsi,
        stochK: indicators.stochasticK,
        williamsR: indicators.williamsR,
        atr: indicators.atr,
        volumeRatio: indicators.volumeRatio,
        trendStrength: result.gateResults.trend.strength,
        sma50dist: indicators.sma50 ? ((closes[i] - indicators.sma50) / indicators.sma50) * 100 : 0,
        sma200dist: indicators.sma200
          ? ((closes[i] - indicators.sma200) / indicators.sma200) * 100
          : 0,
        rsiDelta:
          i >= 3 && rsiArr[i - 14] != null && rsiArr[i - 14 - 3] != null
            ? rsiArr[i - 14] - rsiArr[i - 14 - 3]
            : 0,
        priceDelta: i >= 3 ? ((closes[i] - closes[i - 3]) / closes[i - 3]) * 100 : 0,
        ibs: highs[i] - lows[i] > 0 ? (closes[i] - lows[i]) / (highs[i] - lows[i]) : 0.5,
        rsi2cumul: (() => {
          const r2idx = i - 2;
          if (r2idx >= 1 && rsi2Arr[r2idx] != null && rsi2Arr[r2idx - 1] != null) {
            return rsi2Arr[r2idx] + rsi2Arr[r2idx - 1];
          }
          return 999;
        })(),
        atrDistance: indicators.atr > 0 ? (indicators.sma20 - closes[i]) / indicators.atr : 0,
        consecutiveOversold: (() => {
          let count = 0;
          for (let k = i; k >= Math.max(0, i - 10); k--) {
            const r2idx = k - 2;
            if (r2idx >= 0 && rsi2Arr[r2idx] != null && rsi2Arr[r2idx] < 10) count++;
            else break;
          }
          return count;
        })(),
      });
    }
  }
  return signals;
}

export function measure5DayWinRate(
  signals: BacktestSignal[],
  allData: Map<string, ExecutionCandle[]>,
  costPct: number = DEFAULT_ROUND_TRIP_COST_PCT,
  evaluationWindow: EvaluationWindow = {}
): WinRateResult {
  let wins = 0;
  let total = 0;
  const returns: number[] = [];
  const monthly = createExecutionMonthBreakdown(allData, 5, evaluationWindow);

  for (const sig of signals) {
    if (sig.decision !== 'BUY') continue;

    const prices = allData.get(sig.ticker);
    if (!prices) continue;

    const idx = prices.findIndex((p) => p.date.getTime() === sig.date.getTime());
    const trade = getFixedHoldTrade(prices, idx, 5, costPct);
    if (!trade) continue;
    const entryDate = prices[trade.entryIdx].date;
    if (evaluationWindow.start && entryDate < evaluationWindow.start) continue;
    if (evaluationWindow.end && entryDate > evaluationWindow.end) continue;

    const ret = trade.returnPct;
    returns.push(ret);
    total++;

    const month = trade.entryDate.slice(0, 7);
    if (!monthly[month]) monthly[month] = { wins: 0, total: 0 };
    monthly[month].total++;

    if (ret > 0) {
      wins++;
      monthly[month].wins++;
    }
  }

  const winReturns = returns.filter((r) => r > 0);
  const lossReturns = returns.filter((r) => r <= 0);
  const avgWin =
    winReturns.length > 0 ? winReturns.reduce((a, b) => a + b, 0) / winReturns.length : 0;
  const avgLoss =
    lossReturns.length > 0
      ? Math.abs(lossReturns.reduce((a, b) => a + b, 0) / lossReturns.length)
      : 0;

  const monthCount = Object.keys(monthly).length || 1;

  return {
    winRate5d: total > 0 ? (wins / total) * 100 : 0,
    totalSignals: total,
    wins,
    avgReturn: returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0,
    avgWin,
    avgLoss,
    rewardRisk: avgLoss > 0 ? avgWin / avgLoss : 0,
    monthlyBreakdown: monthly,
    signalsPerMonth: total / monthCount,
    avgHoldBars: 5,
  };
}

export interface EquityPoint {
  date: string;
  equity: number;
}

/** Include quiet calendar months in the supplied price window's signal rate. */
export function createExecutionMonthBreakdown(
  allData: Map<string, ExecutionCandle[]>,
  holdBars = 5,
  evaluationWindow: EvaluationWindow = {}
): Record<string, { wins: number; total: number }> {
  let first = Infinity;
  let last = -Infinity;
  for (const prices of allData.values()) {
    if (prices.length <= holdBars) continue;
    first = Math.min(first, prices[1].date.getTime());
    last = Math.max(last, prices[prices.length - holdBars].date.getTime());
  }
  if (evaluationWindow.start) first = Math.max(first, evaluationWindow.start.getTime());
  if (evaluationWindow.end) last = Math.min(last, evaluationWindow.end.getTime());
  const monthly: Record<string, { wins: number; total: number }> = {};
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) return monthly;
  const start = new Date(first);
  const end = new Date(last);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endMonth = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1);
  while (cursor.getTime() <= endMonth) {
    monthly[cursor.toISOString().slice(0, 7)] = { wins: 0, total: 0 };
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return monthly;
}

export interface BacktestTrade {
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
}

export interface EquityCurveResult {
  points: EquityPoint[];
  trades: BacktestTrade[];
  totalReturn: number;
  maxDrawdown: number;
}

/** A closed-bar signal enters at the next open and holds complete trading sessions. */
export function getFixedHoldTrade(
  prices: ExecutionCandle[],
  signalIdx: number,
  holdBars = 5,
  costPct: number = DEFAULT_ROUND_TRIP_COST_PCT
): (BacktestTrade & { entryIdx: number; exitIdx: number }) | null {
  if (!Number.isInteger(holdBars) || holdBars < 1) {
    throw new Error('holdBars must be a positive integer');
  }
  if (!Number.isFinite(costPct) || costPct < 0) {
    throw new Error('costPct must be a finite non-negative number');
  }
  const entryIdx = signalIdx + 1;
  const exitIdx = signalIdx + holdBars;
  if (signalIdx < 0 || exitIdx >= prices.length) return null;
  const entryPrice = prices[entryIdx].open;
  const exitPrice = prices[exitIdx].close;
  if (
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    !Number.isFinite(exitPrice) ||
    exitPrice <= 0
  ) {
    return null;
  }
  return {
    entryIdx,
    exitIdx,
    entryDate: prices[entryIdx].date.toISOString().slice(0, 10),
    exitDate: prices[exitIdx].date.toISOString().slice(0, 10),
    entryPrice,
    exitPrice,
    returnPct: ((exitPrice - entryPrice) / entryPrice) * 100 - costPct,
  };
}

/** Keep validation-period outcomes out of the training sample. */
export function splitSignalsByExecutionDate(
  signals: BacktestSignal[],
  allData: Map<string, ExecutionCandle[]>,
  boundary: Date,
  holdBars = 5
): { train: BacktestSignal[]; holdout: BacktestSignal[]; purged: BacktestSignal[] } {
  const train: BacktestSignal[] = [];
  const holdout: BacktestSignal[] = [];
  const purged: BacktestSignal[] = [];
  for (const signal of signals) {
    if (signal.decision !== 'BUY') continue;
    const prices = allData.get(signal.ticker);
    if (!prices) continue;
    const idx = prices.findIndex((bar) => bar.date.getTime() === signal.date.getTime());
    const trade = getFixedHoldTrade(prices, idx, holdBars, 0);
    if (!trade) continue;
    if (prices[trade.entryIdx].date >= boundary) holdout.push(signal);
    else if (prices[trade.exitIdx].date < boundary) train.push(signal);
    else purged.push(signal);
  }
  return { train, holdout, purged };
}

/** Candidate choice must not depend on outcomes in a later comparison period. */
export function rankTrainingCandidates<T extends { train: { wr: number; rr: number; n: number } }>(
  candidates: T[]
): T[] {
  return [...candidates].sort(
    (a, b) => b.train.wr - a.train.wr || b.train.rr - a.train.rr || b.train.n - a.train.n
  );
}

/**
 * Compound a single-ticker equity curve from BUY signals using the same
 * fixed-hold semantics as measure5DayWinRate: enter at the next open and exit
 * after `holdBars` completed sessions, one position at a time. Equity is marked
 * at every session close, including unrealized drawdowns and exit costs.
 */
export function buildEquityCurve(
  signals: BacktestSignal[],
  prices: ExecutionCandle[],
  holdBars = 5,
  initialCapital = 10_000,
  costPct: number = DEFAULT_ROUND_TRIP_COST_PCT
): EquityCurveResult {
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) {
    throw new Error('initialCapital must be a finite positive number');
  }
  const buySignals = signals
    .filter((s) => s.decision === 'BUY')
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const idxByTime = new Map<number, number>();
  prices.forEach((p, i) => {
    idxByTime.set(p.date.getTime(), i);
  });

  const points: EquityPoint[] = [];
  const scheduled: NonNullable<ReturnType<typeof getFixedHoldTrade>>[] = [];
  let equity = initialCapital;
  let peak = initialCapital;
  let maxDrawdown = 0;
  let busyUntil = -1;

  for (const sig of buySignals) {
    const idx = idxByTime.get(sig.date.getTime());
    if (idx === undefined) continue;
    const trade = getFixedHoldTrade(prices, idx, holdBars, costPct);
    if (!trade || trade.entryIdx <= busyUntil) continue;
    scheduled.push(trade);
    busyUntil = trade.exitIdx;
  }

  let tradeIdx = 0;
  for (let i = 0; i < prices.length; i++) {
    const trade = scheduled[tradeIdx];
    let markedEquity = equity;
    if (trade && i >= trade.entryIdx) {
      if (i === trade.exitIdx) {
        equity *= 1 + trade.returnPct / 100;
        markedEquity = equity;
        tradeIdx++;
      } else {
        markedEquity = equity * (prices[i].close / trade.entryPrice);
      }
    }
    peak = Math.max(peak, markedEquity);
    maxDrawdown = Math.max(maxDrawdown, ((peak - markedEquity) / peak) * 100);
    points.push({ date: prices[i].date.toISOString().slice(0, 10), equity: markedEquity });
  }

  return {
    points,
    trades: scheduled.map(({ entryIdx: _entryIdx, exitIdx: _exitIdx, ...trade }) => trade),
    totalReturn: ((equity - initialCapital) / initialCapital) * 100,
    maxDrawdown,
  };
}
