/**
 * Pure backtest engine — config-independent ticker context, signal generation,
 * and win-rate measurement, extracted VERBATIM from commands/backtest.ts so the
 * same code paths run in the CLI, the API, and the browser (Web Worker). No
 * I/O: callers inject candles and benchmark series.
 */
import { BollingerBands, EMA, MACD, RSI, SMA, Stochastic, WilliamsR } from 'technicalindicators';
import { type GaussianChannelPoint, gaussianChannel } from '@/services/gaussian-channel';
import { detectPatterns } from '@/services/patterns';
import { evaluateSignal } from '@/services/pipeline';
import type { BenchmarkCandle, CandleData, IndicatorValues, PipelineConfig } from '@/types';

/** Daily OHLCV candle as consumed by the engine. */
export interface Candle {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
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
  i: number
): IndicatorValues | null {
  const rsiVal = rsiArr[i - 14];
  const stochVal = stochArr[i - 14];
  const bbVal = bbArr[i - 20];
  const sma20Val = sma20Arr[i - 20];
  const ema20Val = ema20Arr[i - 20];
  const sma50Val = sma50Arr[i - 50];
  const sma200Val = sma200Arr[i - 200];
  const williamsVal = williamsArr[i - 14];

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
    macd: 0,
    macdSignal: 0,
    macdHistogram: 0,
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
  data: { date: Date; open: number; high: number; low: number; close: number; volume: number }[];
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
  avgDollarVolArr: number[];
  gaussianSeries: GaussianChannelPoint[];
}

export function buildTickerContext(
  data: { date: Date; open: number; high: number; low: number; close: number; volume: number }[],
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

  // ATR
  const atrArr: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 14) {
      atrArr.push(0);
      continue;
    }
    let sum = 0;
    for (let j = i - 13; j <= i; j++) {
      sum += Math.max(
        highs[j] - lows[j],
        Math.abs(highs[j] - closes[j - 1]),
        Math.abs(lows[j] - closes[j - 1])
      );
    }
    atrArr.push(sum / 14);
  }

  // Donchian
  const donchLowerArr: number[] = [];
  const donchUpperArr: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 20) {
      donchLowerArr.push(lows[i]);
      donchUpperArr.push(highs[i]);
      continue;
    }
    donchLowerArr.push(Math.min(...lows.slice(i - 20, i)));
    donchUpperArr.push(Math.max(...highs.slice(i - 20, i)));
  }

  // Volume MA
  const volMaArr: number[] = [];
  for (let i = 0; i < volumes.length; i++) {
    if (i < 20) {
      volMaArr.push(volumes[i] || 1);
      continue;
    }
    volMaArr.push(volumes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20);
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
    for (let k = dvFrom; k <= i; k++) dollarVolSum += data[k].close * data[k].volume;
    avgDollarVolArr[i] = dollarVolSum / (i - dvFrom + 1);
  }

  // Gaussian Channel series — computed ONCE (causal filter ⇒ series[i] equals
  // recomputing on closes[0..i]). Removes the O(n²) per-bar recompute that
  // dominated the institutional/gaussian passes.
  const gaussianSeries = gaussianChannel(closes).series;

  return {
    data,
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
    avgDollarVolArr,
    gaussianSeries,
  };
}

/** Run the config-DEPENDENT signal loop against a precomputed ticker context. */
export function runSignalsWithContext(
  ctx: TickerContext,
  ticker: string,
  config: PipelineConfig
): BacktestSignal[] {
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
    avgDollarVolArr,
    gaussianSeries,
  } = ctx;

  const signals: BacktestSignal[] = [];
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
      i
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

    const histStart = Math.max(0, i - 26 - 4);
    const histEnd = i - 26 + 1;
    const recentMacdHistogram = histEnd > 0 ? macdHistArr.slice(histStart, histEnd) : [0];

    // Detect chart patterns
    const pw = Math.min(i + 1, 50);
    const { score: patternScore } = detectPatterns(
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
      spyCandles,
      sectorCandles,
      avgDailyDollarVol,
      gaussianPoint: gaussianSeries[i],
    });

    // Record BUYs and quality-blocked setups into the cluster window: a setup is
    // judged ONCE on its first score-fire; later bars of the same deteriorating
    // cluster must not re-trigger (matches live "first pullback day" semantics).
    if (result.finalDecision === 'BUY' || result.qualityBlocked) {
      recentBuyDates.push(data[i].date);
    }

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
  allData: Map<string, { date: Date; close: number }[]>
): WinRateResult {
  let wins = 0;
  let total = 0;
  const returns: number[] = [];
  const monthly: Record<string, { wins: number; total: number }> = {};

  for (const sig of signals) {
    if (sig.decision !== 'BUY') continue;

    const prices = allData.get(sig.ticker);
    if (!prices) continue;

    const idx = prices.findIndex((p) => p.date.getTime() === sig.date.getTime());
    if (idx === -1 || idx + 5 >= prices.length) continue;

    const futurePrice = prices[idx + 5].close;
    const ret = ((futurePrice - sig.close) / sig.close) * 100;
    returns.push(ret);
    total++;

    const month = sig.date.toISOString().slice(0, 7);
    if (!monthly[month]) monthly[month] = { wins: 0, total: 0 };
    monthly[month].total++;

    if (futurePrice > sig.close) {
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

/**
 * Compound a single-ticker equity curve from BUY signals using the same
 * fixed-hold semantics as measure5DayWinRate: enter at the signal close, exit
 * `holdBars` bars later, one position at a time (overlapping BUYs are skipped).
 */
export function buildEquityCurve(
  signals: BacktestSignal[],
  prices: { date: Date; close: number }[],
  holdBars = 5,
  initialCapital = 10_000
): EquityCurveResult {
  const buySignals = signals
    .filter((s) => s.decision === 'BUY')
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const idxByTime = new Map<number, number>();
  prices.forEach((p, i) => idxByTime.set(p.date.getTime(), i));

  const points: EquityPoint[] = [];
  const trades: BacktestTrade[] = [];
  let equity = initialCapital;
  let peak = initialCapital;
  let maxDrawdown = 0;
  let busyUntil = -1;

  if (prices.length > 0) {
    points.push({ date: prices[0].date.toISOString().slice(0, 10), equity });
  }

  for (const sig of buySignals) {
    const idx = idxByTime.get(sig.date.getTime());
    if (idx === undefined || idx <= busyUntil || idx + holdBars >= prices.length) continue;

    const exitIdx = idx + holdBars;
    const entryPrice = sig.close;
    const exitPrice = prices[exitIdx].close;
    const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;

    equity *= 1 + returnPct / 100;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100);
    busyUntil = exitIdx;

    trades.push({
      entryDate: sig.date.toISOString().slice(0, 10),
      exitDate: prices[exitIdx].date.toISOString().slice(0, 10),
      entryPrice,
      exitPrice,
      returnPct,
    });
    points.push({ date: prices[exitIdx].date.toISOString().slice(0, 10), equity });
  }

  return {
    points,
    trades,
    totalReturn: ((equity - initialCapital) / initialCapital) * 100,
    maxDrawdown,
  };
}
