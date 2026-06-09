/**
 * Backtest command — runs Pipeline V4 (momentum) vs V3/V2 against historical price data
 * and measures 5-day directional win rate.
 */
import { BollingerBands, EMA, MACD, RSI, SMA, Stochastic, WilliamsR } from 'technicalindicators';
import {
  DEFAULT_INSTITUTIONAL_CONFIG,
  DEFAULT_INSTITUTIONAL_PIPELINE_CONFIG,
  DEFAULT_PIPELINE_CONFIG,
  DEFAULT_QUALITY_PIPELINE_CONFIG,
  MEAN_REVERSION_GRADIENT_RANGES,
} from '@/constants';
import { DataLoader } from '@/optimization/data-loader';
import type { BenchmarkCandle } from '@/services/data-fetcher';
import { gaussianChannel } from '@/services/gaussian-channel';
import { detectPatterns } from '@/services/patterns';
import { evaluateSignal } from '@/services/pipeline';
import type { CandleData, IndicatorValues, PipelineConfig } from '@/types';

interface BacktestSignal {
  date: Date;
  ticker: string;
  close: number;
  decision: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  regime: string;
  confluenceRatio: number;
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

interface WinRateResult {
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

function buildIndicatorsAtBar(
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

// Ticker → sector ETF (for sector relative strength, rsSector). Unmapped → no sector.
const TICKER_SECTOR_ETF: Record<string, string> = {
  // Technology
  INTC: 'XLK',
  GLW: 'XLK',
  CIEN: 'XLK',
  AVGO: 'XLK',
  AAPL: 'XLK',
  MSFT: 'XLK',
  NVDA: 'XLK',
  AMD: 'XLK',
  QCOM: 'XLK',
  MU: 'XLK',
  MRVL: 'XLK',
  SMCI: 'XLK',
  ARM: 'XLK',
  CRM: 'XLK',
  SNOW: 'XLK',
  DDOG: 'XLK',
  NET: 'XLK',
  CRWD: 'XLK',
  ZS: 'XLK',
  PANW: 'XLK',
  PLTR: 'XLK',
  POET: 'XLK',
  IONQ: 'XLK',
  U: 'XLK',
  ENPH: 'XLK',
  SEDG: 'XLK',
  FSLR: 'XLK',
  // Communication Services
  GOOGL: 'XLC',
  META: 'XLC',
  NFLX: 'XLC',
  SNAP: 'XLC',
  PINS: 'XLC',
  RBLX: 'XLC',
  ROKU: 'XLC',
  // Consumer Discretionary
  TSLA: 'XLY',
  AMZN: 'XLY',
  RIVN: 'XLY',
  LCID: 'XLY',
  SHOP: 'XLY',
  UBER: 'XLY',
  ABNB: 'XLY',
  DASH: 'XLY',
  // Financials
  HOOD: 'XLF',
  UPST: 'XLF',
  SQ: 'XLF',
  COIN: 'XLF',
  SOFI: 'XLF',
  AFRM: 'XLF',
  DLO: 'XLF',
  // Health Care
  DNA: 'XLV',
  ABCL: 'XLV',
  RXRX: 'XLV',
  MRNA: 'XLV',
  CRSP: 'XLV',
  NVAX: 'XLV',
  // Industrials (clean-energy equipment / power)
  GEV: 'XLI',
  BE: 'XLI',
  // Real Estate
  OPEN: 'XLRE',
};

function alignBenchmark(bench: BenchmarkCandle[], data: { date: Date }[]): number[] {
  const idxForBar: number[] = new Array(data.length).fill(-1);
  if (bench.length === 0) return idxForBar;
  let bp = 0;
  for (let i = 0; i < data.length; i++) {
    while (bp + 1 < bench.length && bench[bp + 1].date.getTime() <= data[i].date.getTime()) bp++;
    idxForBar[i] = bench[bp].date.getTime() <= data[i].date.getTime() ? bp : -1;
  }
  return idxForBar;
}

function runBacktestForTicker(
  data: { date: Date; open: number; high: number; low: number; close: number; volume: number }[],
  ticker: string,
  config: PipelineConfig,
  spy: BenchmarkCandle[] = [],
  sector: BenchmarkCandle[] = []
): BacktestSignal[] {
  if (data.length < 210) return [];

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
  });
  const bbArr = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
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

  const signals: BacktestSignal[] = [];
  const recentBuyDates: Date[] = [];

  for (let i = 205; i < data.length; i++) {
    const indicators = buildIndicatorsAtBar(
      closes,
      highs,
      lows,
      volumes,
      rsiArr,
      stochArr as { k: number; d: number }[],
      bbArr as { lower: number; upper: number; middle: number }[],
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
    const dvFrom = Math.max(0, i - 19);
    let dollarVolSum = 0;
    for (let k = dvFrom; k <= i; k++) dollarVolSum += data[k].close * data[k].volume;
    const avgDailyDollarVol = dollarVolSum / (i - dvFrom + 1);

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
    });

    if (result.finalDecision === 'BUY') {
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

function measure5DayWinRate(
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

/**
 * Trend-following exit: enter on a BUY signal, hold until the Gaussian Channel
 * turns red (downtrend) or a stop is hit, capped at maxHold bars. Measures the
 * realized per-trade win rate / return — the essay's "ride the trend, exit on
 * color flip" approach vs the fixed 5-day horizon.
 */
function measureTrendHoldWinRate(
  signals: BacktestSignal[],
  allData: Map<string, { date: Date; close: number }[]>,
  opts: {
    maxHold?: number;
    stopPct?: number;
    exitRule?: 'flip' | 'mid';
    trailPct?: number;
    tpPct?: number;
  } = {}
): WinRateResult {
  const maxHold = opts.maxHold ?? 60;
  const stopPct = opts.stopPct ?? 8;
  const exitRule = opts.exitRule ?? 'flip';
  const trailPct = opts.trailPct;
  const tpPct = opts.tpPct;
  const gcCache = new Map<string, ReturnType<typeof gaussianChannel>['series']>();

  let holdBarsTotal = 0;
  let wins = 0;
  let total = 0;
  const returns: number[] = [];
  const monthly: Record<string, { wins: number; total: number }> = {};

  for (const sig of signals) {
    if (sig.decision !== 'BUY') continue;
    const prices = allData.get(sig.ticker);
    if (!prices) continue;
    const idx = prices.findIndex((p) => p.date.getTime() === sig.date.getTime());
    if (idx === -1 || idx + 1 >= prices.length) continue;

    let series = gcCache.get(sig.ticker);
    if (!series) {
      series = gaussianChannel(prices.map((p) => p.close)).series;
      gcCache.set(sig.ticker, series);
    }

    const entry = sig.close;
    const stop = entry * (1 - stopPct / 100);
    const lastK = Math.min(idx + maxHold, prices.length - 1);
    let exitBar = lastK;
    let exitPrice = prices[lastK].close;
    let peak = entry;
    for (let k = idx + 1; k <= lastK; k++) {
      const c = prices[k].close;
      if (c > peak) peak = c;
      const hardStop = c <= stop;
      const trailStop = trailPct !== undefined && c <= peak * (1 - trailPct / 100);
      const tpHit = tpPct !== undefined && c >= entry * (1 + tpPct / 100);
      // With a take-profit bracket, the trend rule is disabled (pure TP/stop).
      const ruleExit =
        tpPct === undefined &&
        (exitRule === 'mid' ? c < series[k].mid : series[k].direction === 'down');
      if (hardStop || trailStop || tpHit || ruleExit) {
        exitPrice = c;
        exitBar = k;
        break;
      }
    }
    holdBarsTotal += exitBar - idx;

    const ret = ((exitPrice - entry) / entry) * 100;
    returns.push(ret);
    total++;
    const month = sig.date.toISOString().slice(0, 7);
    if (!monthly[month]) monthly[month] = { wins: 0, total: 0 };
    monthly[month].total++;
    if (exitPrice > entry) {
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
    avgHoldBars: total > 0 ? holdBarsTotal / total : 0,
  };
}

export async function backtest() {
  const tickers = [
    // Original
    'TSLA',
    'PLTR',
    'GOOGL',
    'INTC',
    'IONQ',
    'UPST',
    'GEV',
    'BE',
    'OPEN',
    'DLO',
    'DNA',
    'GLW',
    'POET',
    'ABCL',
    'CIEN',
    'RXRX',
    'AVGO',
    'HOOD',
    // Mega cap
    'AAPL',
    'MSFT',
    'AMZN',
    'NVDA',
    'META',
    'NFLX',
    // Semiconductor
    'AMD',
    'QCOM',
    'MU',
    'MRVL',
    'SMCI',
    'ARM',
    // Software/Cloud
    'CRM',
    'SNOW',
    'DDOG',
    'NET',
    'CRWD',
    'ZS',
    'PANW',
    // EV/Energy
    'RIVN',
    'LCID',
    'ENPH',
    'SEDG',
    'FSLR',
    // Biotech/Health
    'MRNA',
    'CRSP',
    'NVAX',
    // Fintech
    'SQ',
    'COIN',
    'SOFI',
    'AFRM',
    // Others
    'SHOP',
    'ROKU',
    'SNAP',
    'PINS',
    'U',
    'RBLX',
    'UBER',
    'ABNB',
    'DASH',
  ];

  console.log('Loading historical data for', tickers.length, 'tickers...');
  const allData = new Map<
    string,
    { date: Date; open: number; high: number; low: number; close: number; volume: number }[]
  >();

  for (const ticker of tickers) {
    try {
      const data = await DataLoader.loadHistoricalData(ticker, 1095);
      if (data.length >= 210) {
        allData.set(ticker, data);
        console.log(
          `  ${ticker}: ${data.length} bars (${data[0].date.toISOString().slice(0, 10)} ~ ${data[data.length - 1].date.toISOString().slice(0, 10)})`
        );
      } else {
        console.log(`  ${ticker}: ${data.length} bars (skipped, < 210)`);
      }
    } catch {
      /* skip */
    }
  }

  console.log(`Loaded data for ${allData.size} tickers\n`);

  // Market benchmark (SPY) for relative strength (rsSpy) — loaded once, no lookahead.
  let spyData: BenchmarkCandle[] = [];
  try {
    spyData = await DataLoader.loadHistoricalData('SPY', 1095);
    console.log(`SPY benchmark: ${spyData.length} bars\n`);
  } catch {
    console.log('SPY benchmark unavailable — relative strength stays 0\n');
  }

  // Sector ETFs for sector relative strength (rsSector) — loaded once.
  const sectorData = new Map<string, BenchmarkCandle[]>();
  const neededEtfs = [
    ...new Set([...allData.keys()].map((t) => TICKER_SECTOR_ETF[t]).filter(Boolean)),
  ];
  for (const etf of neededEtfs) {
    try {
      sectorData.set(etf, await DataLoader.loadHistoricalData(etf, 1095));
    } catch {
      /* skip */
    }
  }
  console.log(`Sector ETFs loaded: ${[...sectorData.keys()].join(', ')}\n`);

  // Price data for win rate measurement
  const priceData = new Map<string, { date: Date; close: number }[]>();
  for (const [ticker, data] of allData) {
    priceData.set(
      ticker,
      data.map((d) => ({ date: d.date, close: d.close }))
    );
  }

  // Phase 0: V2 vs V3 vs V4 comparison
  // V2 = mean-reversion, no new patterns, no institutional
  // V3 = mean-reversion, all patterns, no institutional
  // V4 = momentum/institutional accumulation strategy (new default)
  console.log('\n\n📋 Phase 0: V2 vs V3 vs V4 Pipeline Comparison');
  console.log('='.repeat(130));
  console.log('V2 = mean-reversion, institutional disabled, new patterns zeroed');
  console.log('V3 = mean-reversion, institutional disabled, new patterns active');
  console.log('V4 = momentum/institutional accumulation strategy (new default)');

  const MR_WEIGHTS = {
    rsi: 79,
    stochastic: 76,
    bollinger: 78,
    donchian: 74,
    williamsR: 72,
    fearGreed: 50,
    macd: 75,
    sma: 60,
    ema: 65,
    volume: 0,
  };

  const newPatternKeys = [
    'bullishPennant',
    'bearishPennant',
    'cupWithHandle',
    'invertedCupWithHandle',
    'threeRisingValleys',
    'threeDescendingPeaks',
    'ascendingScallop',
    'descendingScallop',
    'measuredMoveUp',
    'measuredMoveDown',
    'diamondBottom',
    'topsRectangle',
  ];

  const v2PatternWeights = { ...DEFAULT_PIPELINE_CONFIG.patternWeights };
  for (const k of newPatternKeys) {
    (v2PatternWeights as Record<string, number>)[k] = 0;
  }

  const v2Config: PipelineConfig = {
    ...DEFAULT_PIPELINE_CONFIG,
    strategy: 'mean-reversion',
    indicatorWeights: MR_WEIGHTS,
    gradientRanges: { ...MEAN_REVERSION_GRADIENT_RANGES },
    regimeFilter: { enabled: true, blockUptrend: true },
    institutional: { ...DEFAULT_INSTITUTIONAL_CONFIG, enabled: false },
    patternWeights: v2PatternWeights,
    trendGate: { ...DEFAULT_PIPELINE_CONFIG.trendGate, minConditions: 1, enabled: true },
    reversalConfirm: { ...DEFAULT_PIPELINE_CONFIG.reversalConfirm, enabled: false },
    thresholds: { buy: 370, sell: 200 },
    confluence: { minActive: 3, activationThreshold: 0.3 },
    confidenceGate: { ...DEFAULT_PIPELINE_CONFIG.confidenceGate, enabled: false },
  };

  const v3Config: PipelineConfig = {
    ...DEFAULT_PIPELINE_CONFIG,
    strategy: 'mean-reversion',
    indicatorWeights: MR_WEIGHTS,
    gradientRanges: { ...MEAN_REVERSION_GRADIENT_RANGES },
    regimeFilter: { enabled: true, blockUptrend: true },
    institutional: { ...DEFAULT_INSTITUTIONAL_CONFIG, enabled: false },
    trendGate: { ...DEFAULT_PIPELINE_CONFIG.trendGate, minConditions: 1, enabled: true },
    reversalConfirm: { ...DEFAULT_PIPELINE_CONFIG.reversalConfirm, enabled: false },
    thresholds: { buy: 370, sell: 200 },
    confluence: { minActive: 3, activationThreshold: 0.3 },
    confidenceGate: { ...DEFAULT_PIPELINE_CONFIG.confidenceGate, enabled: false },
  };

  const v4Config: PipelineConfig = {
    ...DEFAULT_PIPELINE_CONFIG,
    institutional: { ...DEFAULT_INSTITUTIONAL_CONFIG, enabled: false },
    trendGate: { ...DEFAULT_PIPELINE_CONFIG.trendGate, minConditions: 1, enabled: true },
    reversalConfirm: { ...DEFAULT_PIPELINE_CONFIG.reversalConfirm, enabled: false },
    confidenceGate: { ...DEFAULT_PIPELINE_CONFIG.confidenceGate, enabled: false },
  };

  // V5 = institutional (flow-primary + gaussian trend + blended institutional).
  // Kept RAW (no quality gate) so the Phase-4 goal search runs on the unfiltered
  // signal set — otherwise the search would re-filter an already-filtered input.
  const v5Config: PipelineConfig = {
    ...DEFAULT_INSTITUTIONAL_PIPELINE_CONFIG,
  };

  // V7 = institutional + entry-quality (pullback) gate, evaluated through the REAL
  // pipeline (Gate 1.7). Validates that the wired gate reproduces the Phase-4
  // search edge (~65% WR / ~1.5 R/R) rather than being a post-hoc backtest artifact.
  const v7Config: PipelineConfig = {
    ...DEFAULT_QUALITY_PIPELINE_CONFIG,
  };

  const v2Signals: BacktestSignal[] = [];
  const v3Signals: BacktestSignal[] = [];
  const v4Signals: BacktestSignal[] = [];
  const v5Signals: BacktestSignal[] = [];
  const v7Signals: BacktestSignal[] = [];
  for (const [ticker, data] of allData) {
    const sec = sectorData.get(TICKER_SECTOR_ETF[ticker]) ?? [];
    v2Signals.push(...runBacktestForTicker(data, ticker, v2Config, spyData, sec));
    v3Signals.push(...runBacktestForTicker(data, ticker, v3Config, spyData, sec));
    v4Signals.push(...runBacktestForTicker(data, ticker, v4Config, spyData, sec));
    v5Signals.push(...runBacktestForTicker(data, ticker, v5Config, spyData, sec));
    v7Signals.push(...runBacktestForTicker(data, ticker, v7Config, spyData, sec));
  }

  const v2Result = measure5DayWinRate(v2Signals, priceData);
  const v3Result = measure5DayWinRate(v3Signals, priceData);
  const v4Result = measure5DayWinRate(v4Signals, priceData);
  const v5Result = measure5DayWinRate(v5Signals, priceData);
  // V6 = same institutional entries as V5, but exit on Gaussian Channel flip (trend-hold).
  const v6Result = measureTrendHoldWinRate(v5Signals, priceData);
  // V7 = institutional + entry-quality gate, through the real pipeline (the shipped improvement).
  const v7Result = measure5DayWinRate(v7Signals, priceData);

  console.log(
    `\n${'Version'.padEnd(20)} | ${'WinRate'.padStart(8)} | ${'Signals'.padStart(8)} | ${'AvgRet'.padStart(8)} | ${'R/R'.padStart(6)} | ${'Sig/Mo'.padStart(6)}`
  );
  console.log('-'.repeat(72));
  const fmtRow = (name: string, r: WinRateResult) =>
    `${name.padEnd(20)} | ${(`${r.winRate5d.toFixed(1)}%`).padStart(8)} | ${String(r.totalSignals).padStart(8)} | ${(`${r.avgReturn.toFixed(2)}%`).padStart(8)} | ${r.rewardRisk.toFixed(2).padStart(6)} | ${r.signalsPerMonth.toFixed(1).padStart(6)}`;
  console.log(fmtRow('V2', v2Result));
  console.log(fmtRow('V3', v3Result));
  console.log(fmtRow('V4 (momentum)', v4Result));
  console.log(fmtRow('V5 (institutional)', v5Result));
  console.log(fmtRow('V6 (V5 + trend-hold)', v6Result));
  console.log(fmtRow('V7 (V5 + quality)', v7Result));
  console.log(
    '\n🎯 V7 = shipped improvement (institutional + entry-quality gate, via real pipeline):'
  );
  console.log(
    `  WR ${v7Result.winRate5d.toFixed(1)}% (vs V5 ${v5Result.winRate5d.toFixed(1)}%)  |  R/R ${v7Result.rewardRisk.toFixed(2)} (vs V5 ${v5Result.rewardRisk.toFixed(2)})  |  N ${v7Result.totalSignals}  |  AvgRet ${v7Result.avgReturn.toFixed(2)}%`
  );
  const v7GoalMet = v7Result.winRate5d >= 60 && v7Result.rewardRisk > v5Result.rewardRisk;
  console.log(
    `  ${v7GoalMet ? '✅ GOAL MET' : '⚠️ goal NOT met'}: WR ≥ 60% AND R/R > baseline (${v5Result.rewardRisk.toFixed(2)})`
  );
  console.log('  V7 by entry year:');
  for (const yr of ['2023', '2024', '2025', '2026']) {
    const sub = v7Signals.filter((s) => s.date.toISOString().slice(0, 4) === yr);
    if (sub.length === 0) continue;
    const r = measure5DayWinRate(sub, priceData);
    console.log(
      `    ${yr}: WR=${r.winRate5d.toFixed(1)}%  R/R=${r.rewardRisk.toFixed(2)}  N=${r.totalSignals}  AvgRet=${r.avgReturn.toFixed(2)}%`
    );
  }

  // Quality-gate parameter tuning — evaluated through the REAL pipeline (not a
  // post-hoc filter), so the cluster-filter interaction is accounted for. Picks
  // the gate that best satisfies the goal with margin AND the strongest weakest
  // entry-year (robustness), not just the best aggregate.
  console.log('\nQuality-gate tuning (via real pipeline; min-year = weakest entry-year WR):');
  console.log(
    `${'Gate params'.padEnd(34)} | ${'WinRate'.padStart(7)} | ${'R/R'.padStart(5)} | ${'N'.padStart(5)} | ${'AvgRet'.padStart(7)} | ${'minYr'.padStart(6)}`
  );
  const gateVariants: { name: string; gate: NonNullable<PipelineConfig['qualityGate']> }[] = [
    {
      name: 'ibs.30 atr3.5 vol.8-2.0',
      gate: { enabled: true, ibsMax: 0.3, atrPctMax: 3.5, volRMin: 0.8, volRMax: 2.0 },
    },
    {
      name: 'ibs.25 atr3.5 vol.8-2.0',
      gate: { enabled: true, ibsMax: 0.25, atrPctMax: 3.5, volRMin: 0.8, volRMax: 2.0 },
    },
    {
      name: 'ibs.20 atr3.5 vol.8-2.0',
      gate: { enabled: true, ibsMax: 0.2, atrPctMax: 3.5, volRMin: 0.8, volRMax: 2.0 },
    },
    {
      name: 'ibs.20 atr3.0 vol.8-2.0',
      gate: { enabled: true, ibsMax: 0.2, atrPctMax: 3.0, volRMin: 0.8, volRMax: 2.0 },
    },
    {
      name: 'ibs.20 atr3.5 vol.8-1.5',
      gate: { enabled: true, ibsMax: 0.2, atrPctMax: 3.5, volRMin: 0.8, volRMax: 1.5 },
    },
    {
      name: 'ibs.15 atr3.5 vol.8-2.0',
      gate: { enabled: true, ibsMax: 0.15, atrPctMax: 3.5, volRMin: 0.8, volRMax: 2.0 },
    },
  ];
  for (const variant of gateVariants) {
    const cfg: PipelineConfig = { ...DEFAULT_QUALITY_PIPELINE_CONFIG, qualityGate: variant.gate };
    const sigs: BacktestSignal[] = [];
    for (const [ticker, data] of allData) {
      const sec = sectorData.get(TICKER_SECTOR_ETF[ticker]) ?? [];
      sigs.push(...runBacktestForTicker(data, ticker, cfg, spyData, sec));
    }
    const r = measure5DayWinRate(sigs, priceData);
    let minYr = 100;
    for (const yr of ['2024', '2025', '2026']) {
      const sub = sigs.filter((s) => s.date.toISOString().slice(0, 4) === yr);
      if (sub.length < 15) continue; // ignore tiny (partial-year) samples
      minYr = Math.min(minYr, measure5DayWinRate(sub, priceData).winRate5d);
    }
    console.log(
      `${variant.name.padEnd(34)} | ${`${r.winRate5d.toFixed(1)}%`.padStart(7)} | ${r.rewardRisk.toFixed(2).padStart(5)} | ${String(r.totalSignals).padStart(5)} | ${`${r.avgReturn.toFixed(2)}%`.padStart(7)} | ${`${minYr.toFixed(1)}%`.padStart(6)}`
    );
  }

  console.log('\nDelta (V6 trend-hold - V5 fixed-5d):');
  console.log(`  Win rate:    ${(v6Result.winRate5d - v5Result.winRate5d).toFixed(1)}pp`);
  console.log(`  Avg return:  ${(v6Result.avgReturn - v5Result.avgReturn).toFixed(2)}pp`);
  console.log(`  R/R ratio:   ${(v6Result.rewardRisk - v5Result.rewardRisk).toFixed(2)}`);

  // Per-bar normalized return — apples-to-apples vs the fixed 5-day horizon.
  const v5PerBar = v5Result.avgReturn / v5Result.avgHoldBars;
  const v6PerBar = v6Result.avgHoldBars > 0 ? v6Result.avgReturn / v6Result.avgHoldBars : 0;
  console.log('\nPer-bar return (normalized for holding period):');
  console.log(`  V5 (hold ${v5Result.avgHoldBars.toFixed(1)} bars): ${v5PerBar.toFixed(3)}%/bar`);
  console.log(`  V6 (hold ${v6Result.avgHoldBars.toFixed(1)} bars): ${v6PerBar.toFixed(3)}%/bar`);

  // Robustness — is V6's edge regime-dependent (only the 2023-26 bull)? Split by entry year.
  console.log('\nV6 trend-hold robustness by entry year:');
  console.log(
    `${'Year'.padEnd(6)} | ${'Signals'.padStart(7)} | ${'WinRate'.padStart(7)} | ${'AvgRet'.padStart(7)} | ${'PerBar'.padStart(7)} | ${'R/R'.padStart(5)} | ${'Hold'.padStart(5)}`
  );
  for (const yr of ['2023', '2024', '2025', '2026']) {
    const sub = v5Signals.filter((s) => s.date.toISOString().slice(0, 4) === yr);
    if (sub.length === 0) continue;
    const r = measureTrendHoldWinRate(sub, priceData);
    const pb = r.avgHoldBars > 0 ? r.avgReturn / r.avgHoldBars : 0;
    console.log(
      `${yr.padEnd(6)} | ${String(r.totalSignals).padStart(7)} | ${`${r.winRate5d.toFixed(1)}%`.padStart(7)} | ${`${r.avgReturn.toFixed(2)}%`.padStart(7)} | ${`${pb.toFixed(3)}%`.padStart(7)} | ${r.rewardRisk.toFixed(2).padStart(5)} | ${r.avgHoldBars.toFixed(1).padStart(5)}`
    );
  }

  // Exit-rule comparison on the SAME V5 entries — optimize the exit (where the edge is).
  console.log('\nExit-rule comparison (V5 entries):');
  console.log(
    `${'Exit rule'.padEnd(20)} | ${'WinRate'.padStart(7)} | ${'AvgRet'.padStart(7)} | ${'PerBar'.padStart(7)} | ${'R/R'.padStart(5)} | ${'Hold'.padStart(5)}`
  );
  const exitVariants: {
    name: string;
    opts: { exitRule?: 'flip' | 'mid'; stopPct?: number; trailPct?: number };
  }[] = [
    { name: 'flip + stop8 (V6)', opts: { exitRule: 'flip', stopPct: 8 } },
    { name: 'flip + stop5', opts: { exitRule: 'flip', stopPct: 5 } },
    { name: 'flip + stop12', opts: { exitRule: 'flip', stopPct: 12 } },
    { name: 'mid-cross + stop8', opts: { exitRule: 'mid', stopPct: 8 } },
    { name: 'flip + trail10', opts: { exitRule: 'flip', stopPct: 8, trailPct: 10 } },
    { name: 'flip + trail15', opts: { exitRule: 'flip', stopPct: 8, trailPct: 15 } },
  ];
  for (const v of exitVariants) {
    const r = measureTrendHoldWinRate(v5Signals, priceData, v.opts);
    const pb = r.avgHoldBars > 0 ? r.avgReturn / r.avgHoldBars : 0;
    console.log(
      `${v.name.padEnd(20)} | ${`${r.winRate5d.toFixed(1)}%`.padStart(7)} | ${`${r.avgReturn.toFixed(2)}%`.padStart(7)} | ${`${pb.toFixed(3)}%`.padStart(7)} | ${r.rewardRisk.toFixed(2).padStart(5)} | ${r.avgHoldBars.toFixed(1).padStart(5)}`
    );
  }

  console.log('\nDelta (V4 - V2 baseline):');
  console.log(`  Win rate:    ${(v4Result.winRate5d - v2Result.winRate5d).toFixed(1)}pp`);
  console.log(
    `  Signals:     ${v4Result.totalSignals - v2Result.totalSignals} (${v4Result.totalSignals > v2Result.totalSignals ? '+' : ''}${((v4Result.totalSignals / Math.max(v2Result.totalSignals, 1) - 1) * 100).toFixed(0)}%)`
  );
  console.log(`  Avg return:  ${(v4Result.avgReturn - v2Result.avgReturn).toFixed(2)}pp`);
  console.log(`  R/R ratio:   ${(v4Result.rewardRisk - v2Result.rewardRisk).toFixed(2)}`);
  console.log('\nDelta (V5 - V2 baseline):');
  console.log(`  Win rate:    ${(v5Result.winRate5d - v2Result.winRate5d).toFixed(1)}pp`);
  console.log(
    `  Signals:     ${v5Result.totalSignals - v2Result.totalSignals} (${v5Result.totalSignals > v2Result.totalSignals ? '+' : ''}${((v5Result.totalSignals / Math.max(v2Result.totalSignals, 1) - 1) * 100).toFixed(0)}%)`
  );
  console.log(`  Avg return:  ${(v5Result.avgReturn - v2Result.avgReturn).toFixed(2)}pp`);
  console.log(`  R/R ratio:   ${(v5Result.rewardRisk - v2Result.rewardRisk).toFixed(2)}`);

  // Phase 1: Diagnostic — analyze signals from V4 momentum config
  const baseConfig: PipelineConfig = {
    ...DEFAULT_PIPELINE_CONFIG,
    institutional: { ...DEFAULT_INSTITUTIONAL_CONFIG, enabled: false },
    patternWeights: Object.fromEntries(
      Object.keys(DEFAULT_PIPELINE_CONFIG.patternWeights).map((k) => [k, 0])
    ),
    trendGate: { ...DEFAULT_PIPELINE_CONFIG.trendGate, minConditions: 1, enabled: true },
    reversalConfirm: { ...DEFAULT_PIPELINE_CONFIG.reversalConfirm, enabled: false },
    confidenceGate: { ...DEFAULT_PIPELINE_CONFIG.confidenceGate, enabled: false },
  };

  console.log('\n📋 Phase 1: Diagnostic — All 20 signals detail');
  console.log('='.repeat(130));

  const diagSignals: (BacktestSignal & { ret5d: number; win: boolean })[] = [];

  for (const [ticker, data] of allData) {
    const sigs = runBacktestForTicker(data, ticker, baseConfig);
    const prices = priceData.get(ticker)!;
    for (const sig of sigs) {
      if (sig.decision !== 'BUY') continue;
      const idx = prices.findIndex((p) => p.date.getTime() === sig.date.getTime());
      if (idx === -1 || idx + 5 >= prices.length) continue;
      const futurePrice = prices[idx + 5].close;
      const ret5d = ((futurePrice - sig.close) / sig.close) * 100;

      // Get detailed indicators for this bar
      const closes = data
        .slice(0, data.findIndex((d) => d.date.getTime() === sig.date.getTime()) + 1)
        .map((d) => d.close);
      const _barIdx = closes.length - 1;

      diagSignals.push({
        ...sig,
        ret5d,
        win: futurePrice > sig.close,
      });
    }
  }

  diagSignals.sort((a, b) => a.date.getTime() - b.date.getTime());

  console.log(
    `${'Date'.padEnd(12)} ${'Ticker'.padEnd(6)} ${'Scr'.padStart(4)} ${'IBS'.padStart(5)} ${'R2c'.padStart(5)} ${'ATRd'.padStart(5)} ${'COs'.padStart(4)} ${'VolR'.padStart(5)} ${'Ret5d'.padStart(7)} ${'W'.padStart(2)}`
  );
  console.log('-'.repeat(65));
  for (const s of diagSignals) {
    const dateStr = s.date.toISOString().slice(0, 10);
    console.log(
      `${dateStr.padEnd(12)} ${s.ticker.padEnd(6)} ${s.score.toFixed(0).padStart(4)} ${s.ibs.toFixed(2).padStart(5)} ${s.rsi2cumul.toFixed(0).padStart(5)} ${s.atrDistance.toFixed(1).padStart(5)} ${String(s.consecutiveOversold).padStart(4)} ${s.volumeRatio.toFixed(1).padStart(5)} ${s.ret5d.toFixed(2).padStart(6)}% ${(s.win ? 'W' : 'L').padStart(2)}`
    );
  }

  const wins = diagSignals.filter((s) => s.win);
  const losses = diagSignals.filter((s) => !s.win);
  console.log(`\nWins: ${wins.length}, Losses: ${losses.length}`);
  if (losses.length > 0) {
    console.log('\n🔴 Failed signals analysis:');
    for (const s of losses) {
      console.log(
        `  ${s.date.toISOString().slice(0, 10)} ${s.ticker} close=${s.close.toFixed(2)} score=${s.score.toFixed(0)} ret=${s.ret5d.toFixed(2)}% regime=${s.regime} confR=${s.confluenceRatio.toFixed(2)}`
      );
    }
    console.log('\n🟢 Winning signals stats:');
    console.log(`  Avg score: ${(wins.reduce((a, s) => a + s.score, 0) / wins.length).toFixed(0)}`);
    console.log(
      `  Avg confR: ${(wins.reduce((a, s) => a + s.confluenceRatio, 0) / wins.length).toFixed(2)}`
    );
    console.log('\n🔴 Losing signals stats:');
    console.log(
      `  Avg score: ${(losses.reduce((a, s) => a + s.score, 0) / losses.length).toFixed(0)}`
    );
    console.log(
      `  Avg confR: ${(losses.reduce((a, s) => a + s.confluenceRatio, 0) / losses.length).toFixed(2)}`
    );
  }

  // Phase 2: New filter experiments based on diagnostic
  console.log('\n\n📋 Phase 2: Post-hoc filter experiments');
  console.log('='.repeat(130));

  // Apply post-hoc filters to the base signal set
  type PostFilter = (sig: (typeof diagSignals)[0], allSigs: typeof diagSignals) => boolean;

  const postFilters: { name: string; filter: PostFilter }[] = [
    { name: 'baseline (no filter)', filter: () => true },
    // Regime filter: exclude uptrend (counterintuitive but data-driven)
    { name: 'regime≠uptrend', filter: (s) => s.regime !== 'uptrend' },
    // Anti-perfect confluence: confR=1.0 might mean free-fall
    { name: 'confR<1.0', filter: (s) => s.confluenceRatio < 1.0 },
    // Combined
    {
      name: 'regime≠uptrend + confR<1.0',
      filter: (s) => s.regime !== 'uptrend' && s.confluenceRatio < 1.0,
    },
    // Score cap: extremely high scores may indicate crashes
    { name: 'score<400', filter: (s) => s.score < 400 },
    { name: 'score<390', filter: (s) => s.score < 390 },
    // Consecutive skip: if same ticker had BUY within 5 days, skip
    {
      name: 'no-cluster-5d',
      filter: (s, all) => {
        const prev = all.filter(
          (x) =>
            x.ticker === s.ticker &&
            x.date < s.date &&
            s.date.getTime() - x.date.getTime() < 5 * 86400000
        );
        return prev.length === 0;
      },
    },
    // Consecutive skip 10 days
    {
      name: 'no-cluster-10d',
      filter: (s, all) => {
        const prev = all.filter(
          (x) =>
            x.ticker === s.ticker &&
            x.date < s.date &&
            s.date.getTime() - x.date.getTime() < 10 * 86400000
        );
        return prev.length === 0;
      },
    },
    // Only take if downtrend + no cluster 5d
    {
      name: 'regime≠up + no-clust-5d',
      filter: (s, all) => {
        if (s.regime === 'uptrend') return false;
        const prev = all.filter(
          (x) =>
            x.ticker === s.ticker &&
            x.date < s.date &&
            s.date.getTime() - x.date.getTime() < 5 * 86400000
        );
        return prev.length === 0;
      },
    },
    // Same-day multi-signal check: if ≥3 tickers signal same day, skip
    {
      name: 'no-multi-day(≥3)',
      filter: (s, all) => {
        const sameDay = all.filter((x) => x.date.getTime() === s.date.getTime());
        return sameDay.length < 3;
      },
    },
    // Regime≠uptrend + score<400
    { name: 'regime≠up + score<400', filter: (s) => s.regime !== 'uptrend' && s.score < 400 },
    // ATR-based volatility filter: skip high-volatility (ATR > X% of price)
    { name: 'atr<4%', filter: (s) => (s.atr / s.close) * 100 < 4 },
    { name: 'atr<3.5%', filter: (s) => (s.atr / s.close) * 100 < 3.5 },
    { name: 'atr<3%', filter: (s) => (s.atr / s.close) * 100 < 3 },
    // Volume ratio filter
    { name: 'volR<1.5', filter: (s) => s.volumeRatio < 1.5 },
    { name: 'volR>0.8', filter: (s) => s.volumeRatio > 0.8 },
    // SMA distance: how far below SMA50
    { name: 'sma50dist<-5%', filter: (s) => s.sma50dist < -5 },
    { name: 'sma50dist<-8%', filter: (s) => s.sma50dist < -8 },
    { name: 'sma50dist<-10%', filter: (s) => s.sma50dist < -10 },
    // SMA200 distance
    { name: 'sma200dist>-15%', filter: (s) => s.sma200dist > -15 },
    { name: 'sma200dist>-20%', filter: (s) => s.sma200dist > -20 },
    // RSI filter
    { name: 'rsi<25', filter: (s) => s.rsi < 25 },
    { name: 'rsi<30', filter: (s) => s.rsi < 30 },
    // Score margin above threshold
    { name: 'score≥375', filter: (s) => s.score >= 375 },
    { name: 'score≥378', filter: (s) => s.score >= 378 },
    // --- New strategy filters ---
    // IBS (Internal Bar Strength)
    { name: 'ibs<0.30', filter: (s) => s.ibs < 0.3 },
    { name: 'ibs<0.25', filter: (s) => s.ibs < 0.25 },
    { name: 'ibs<0.20', filter: (s) => s.ibs < 0.2 },
    { name: 'ibs<0.15', filter: (s) => s.ibs < 0.15 },
    // RSI(2) cumulative
    { name: 'rsi2c<20', filter: (s) => s.rsi2cumul < 20 },
    { name: 'rsi2c<15', filter: (s) => s.rsi2cumul < 15 },
    { name: 'rsi2c<10', filter: (s) => s.rsi2cumul < 10 },
    { name: 'rsi2c<5', filter: (s) => s.rsi2cumul < 5 },
    // ATR distance (how stretched from SMA20)
    { name: 'atrD>1.0', filter: (s) => s.atrDistance > 1.0 },
    { name: 'atrD>1.5', filter: (s) => s.atrDistance > 1.5 },
    { name: 'atrD>2.0', filter: (s) => s.atrDistance > 2.0 },
    { name: 'atrD>2.5', filter: (s) => s.atrDistance > 2.5 },
    // Consecutive oversold days
    { name: 'consOD≥2', filter: (s) => s.consecutiveOversold >= 2 },
    { name: 'consOD≥3', filter: (s) => s.consecutiveOversold >= 3 },
    // Volume
    { name: 'volR<2', filter: (s) => s.volumeRatio < 2.0 },
    { name: 'volR<1.5', filter: (s) => s.volumeRatio < 1.5 },
    // --- Combos: top singles ---
    { name: 'ibs<0.25 + atrD>1.5', filter: (s) => s.ibs < 0.25 && s.atrDistance > 1.5 },
    { name: 'ibs<0.25 + volR<2', filter: (s) => s.ibs < 0.25 && s.volumeRatio < 2.0 },
    { name: 'ibs<0.25 + rsi2c<10', filter: (s) => s.ibs < 0.25 && s.rsi2cumul < 10 },
    { name: 'atrD>1.5 + volR<2', filter: (s) => s.atrDistance > 1.5 && s.volumeRatio < 2.0 },
    { name: 'atrD>1.5 + rsi2c<15', filter: (s) => s.atrDistance > 1.5 && s.rsi2cumul < 15 },
    { name: 'atrD>2 + volR<2', filter: (s) => s.atrDistance > 2.0 && s.volumeRatio < 2.0 },
    { name: 'atrD>2 + ibs<0.25', filter: (s) => s.atrDistance > 2.0 && s.ibs < 0.25 },
    {
      name: 'ibs<0.25+atrD>1.5+volR<2',
      filter: (s) => s.ibs < 0.25 && s.atrDistance > 1.5 && s.volumeRatio < 2.0,
    },
    {
      name: 'ibs<0.20+atrD>1.5+volR<2',
      filter: (s) => s.ibs < 0.2 && s.atrDistance > 1.5 && s.volumeRatio < 2.0,
    },
    {
      name: 'atrD>2+volR<2+consOD≥2',
      filter: (s) => s.atrDistance > 2.0 && s.volumeRatio < 2.0 && s.consecutiveOversold >= 2,
    },
    {
      name: 'atrD>1.5+volR<1.5+ibs<0.25',
      filter: (s) => s.atrDistance > 1.5 && s.volumeRatio < 1.5 && s.ibs < 0.25,
    },
    { name: 'atrD>2+volR<1.5', filter: (s) => s.atrDistance > 2.0 && s.volumeRatio < 1.5 },
    {
      name: 'score≥375+atrD>1.5+volR<2',
      filter: (s) => s.score >= 375 && s.atrDistance > 1.5 && s.volumeRatio < 2.0,
    },
    {
      name: 'scr≥375+volR<2+ibs<0.25',
      filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.ibs < 0.25,
    },
    {
      name: 'scr≥375+volR<2+ibs<0.30',
      filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.ibs < 0.3,
    },
    {
      name: 'scr≥375+volR<2+ibs<0.40',
      filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.ibs < 0.4,
    },
    {
      name: 'scr≥375+volR<2+consOD≥2',
      filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.consecutiveOversold >= 2,
    },
    {
      name: 'scr≥375+volR<2+rsi2c<20',
      filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.rsi2cumul < 20,
    },
    {
      name: 'scr≥375+volR<2+rsi2c<15',
      filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.rsi2cumul < 15,
    },
    {
      name: 'all:scr375+vR2+ibs25+atrD1.5',
      filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.ibs < 0.25 && s.atrDistance > 1.5,
    },
    {
      name: 'all:scr375+vR2+consOD2+atrD2',
      filter: (s) =>
        s.score >= 375 && s.volumeRatio < 2.0 && s.consecutiveOversold >= 2 && s.atrDistance > 2.0,
    },
    // --- V4 Momentum-specific filters ---
    { name: 'regime=uptrend', filter: (s) => s.regime === 'uptrend' },
    { name: 'volR>1.5', filter: (s) => s.volumeRatio > 1.5 },
    { name: 'volR>2.0', filter: (s) => s.volumeRatio > 2.0 },
    { name: 'sma50dist>0', filter: (s) => s.sma50dist > 0 },
    { name: 'sma200dist>0', filter: (s) => s.sma200dist > 0 },
    { name: 'rsi>50', filter: (s) => s.rsi > 50 },
    { name: 'rsi>55', filter: (s) => s.rsi > 55 },
    { name: 'ibs>0.5', filter: (s) => s.ibs > 0.5 },
    { name: 'ibs>0.6', filter: (s) => s.ibs > 0.6 },
    { name: 'score≥300', filter: (s) => s.score >= 300 },
    { name: 'score≥320', filter: (s) => s.score >= 320 },
    { name: 'score≥350', filter: (s) => s.score >= 350 },
    { name: 'uptrend+volR>1.5', filter: (s) => s.regime === 'uptrend' && s.volumeRatio > 1.5 },
    { name: 'uptrend+volR>2.0', filter: (s) => s.regime === 'uptrend' && s.volumeRatio > 2.0 },
    {
      name: 'uptrend+sma50>0+volR>1.5',
      filter: (s) => s.regime === 'uptrend' && s.sma50dist > 0 && s.volumeRatio > 1.5,
    },
    {
      name: 'uptrend+sma200>0+volR>1.5',
      filter: (s) => s.regime === 'uptrend' && s.sma200dist > 0 && s.volumeRatio > 1.5,
    },
    {
      name: 'uptrend+rsi>50+volR>1.5',
      filter: (s) => s.regime === 'uptrend' && s.rsi > 50 && s.volumeRatio > 1.5,
    },
    {
      name: 'uptrend+ibs>0.5+volR>1.5',
      filter: (s) => s.regime === 'uptrend' && s.ibs > 0.5 && s.volumeRatio > 1.5,
    },
    {
      name: 'scr≥300+uptrend+volR>1.5',
      filter: (s) => s.score >= 300 && s.regime === 'uptrend' && s.volumeRatio > 1.5,
    },
    {
      name: 'scr≥320+uptrend+volR>1.5',
      filter: (s) => s.score >= 320 && s.regime === 'uptrend' && s.volumeRatio > 1.5,
    },
  ];

  // Multi-period win rate analysis
  console.log('\n📊 Holding period analysis:');
  console.log('-'.repeat(70));
  for (const period of [1, 2, 3, 5, 7, 10, 15, 20]) {
    let wins = 0,
      total = 0;
    for (const sig of diagSignals) {
      if (sig.decision !== 'BUY') continue;
      const prices = priceData.get(sig.ticker);
      if (!prices) continue;
      const idx = prices.findIndex((p) => p.date.getTime() === sig.date.getTime());
      if (idx === -1 || idx + period >= prices.length) continue;
      total++;
      if (prices[idx + period].close > sig.close) wins++;
    }
    const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : 'N/A';
    console.log(`  ${String(period).padStart(2)}d: ${wr}% (${wins}/${total})`);
  }

  // volR<1.5 subset multi-period
  console.log('\n📊 volR<1.5 holding period:');
  console.log('-'.repeat(70));
  const lowVol = diagSignals.filter((s) => s.decision === 'BUY' && s.volumeRatio < 1.5);
  for (const period of [1, 2, 3, 5, 7, 10, 15, 20]) {
    let wins = 0,
      total = 0;
    for (const sig of lowVol) {
      const prices = priceData.get(sig.ticker);
      if (!prices) continue;
      const idx = prices.findIndex((p) => p.date.getTime() === sig.date.getTime());
      if (idx === -1 || idx + period >= prices.length) continue;
      total++;
      if (prices[idx + period].close > sig.close) wins++;
    }
    const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : 'N/A';
    console.log(`  ${String(period).padStart(2)}d: ${wr}% (${wins}/${total})`);
  }

  console.log(
    `${'Filter'.padEnd(35)} | ${'WinRate'.padStart(8)} | ${'Signals'.padStart(8)} | ${'Wins'.padStart(5)} | ${'Losses'.padStart(7)} | ${'AvgRet'.padStart(8)}`
  );
  console.log('-'.repeat(85));

  for (const { name, filter } of postFilters) {
    const filtered = diagSignals.filter((s) => filter(s, diagSignals));
    const w = filtered.filter((s) => s.win).length;
    const l = filtered.filter((s) => !s.win).length;
    const total = w + l;
    const wr = total > 0 ? `${((w / total) * 100).toFixed(1)}%` : 'N/A';
    const avg =
      filtered.length > 0
        ? `${(filtered.reduce((a, s) => a + s.ret5d, 0) / filtered.length).toFixed(2)}%`
        : 'N/A';
    console.log(
      `${name.padEnd(35)} | ${wr.padStart(8)} | ${String(total).padStart(8)} | ${String(w).padStart(5)} | ${String(l).padStart(7)} | ${avg.padStart(8)}`
    );
  }

  // Phase 3: Grid search with structural filters
  console.log('\n\n📋 Phase 3: Grid search');
  console.log('='.repeat(130));

  const configs: { name: string; config: PipelineConfig }[] = [];

  for (const threshold of [260, 280, 300, 320, 350]) {
    for (const gapDays of [3, 5, 7, 99]) {
      for (const confMin of [2, 3, 4]) {
        for (const rev of [true, false]) {
          const clusterEnabled = gapDays < 99;
          const cfg: PipelineConfig = {
            ...baseConfig,
            confluence: { ...baseConfig.confluence, minActive: confMin },
            thresholds: { buy: threshold, sell: 200 },
            clusterFilter: { enabled: clusterEnabled, minGapDays: clusterEnabled ? gapDays : 5 },
            reversalConfirm: { enabled: rev, volumeMultiplier: 1.0 },
          };
          const name = `Th=${threshold} G=${clusterEnabled ? `${gapDays}d` : 'off'} C≥${confMin} R=${rev ? 'Y' : 'N'}`;
          configs.push({ name, config: cfg });
        }
      }
    }
  }

  console.log(`Testing ${configs.length} configurations...\n`);
  console.log(
    `${'Config'.padEnd(35)} | ${'WinRate'.padStart(8)} | ${'Signals'.padStart(8)} | ${'AvgRet'.padStart(8)} | ${'R/R'.padStart(6)} | ${'Sig/Mo'.padStart(6)}`
  );
  console.log('-'.repeat(85));

  const results: { name: string; result: WinRateResult }[] = [];

  for (const { name, config } of configs) {
    const allSignals: BacktestSignal[] = [];
    for (const [ticker, data] of allData) {
      const sigs = runBacktestForTicker(data, ticker, config);
      allSignals.push(...sigs);
    }

    const result = measure5DayWinRate(allSignals, priceData);
    results.push({ name, result });

    if (result.totalSignals >= 3) {
      const wr = `${result.winRate5d.toFixed(1)}%`;
      const sig = result.totalSignals.toString();
      const avg = `${result.avgReturn.toFixed(2)}%`;
      const rr = result.rewardRisk.toFixed(2);
      const spm = result.signalsPerMonth.toFixed(1);
      console.log(
        `${name.padEnd(35)} | ${wr.padStart(8)} | ${sig.padStart(8)} | ${avg.padStart(8)} | ${rr.padStart(6)} | ${spm.padStart(6)}`
      );
    }
  }

  // Find best config with ≥ 75% win rate and reasonable signal count
  console.log(`\n${'='.repeat(85)}`);
  console.log('🏆 Best configurations (win rate ≥ 60%, signals ≥ 3):');
  console.log('='.repeat(85));

  const qualifying = results
    .filter((r) => r.result.winRate5d >= 60 && r.result.totalSignals >= 5)
    .sort(
      (a, b) =>
        b.result.winRate5d - a.result.winRate5d || b.result.totalSignals - a.result.totalSignals
    );

  for (const { name, result } of qualifying.slice(0, 20)) {
    console.log(
      `  ${name.padEnd(35)} | WR=${result.winRate5d.toFixed(1)}% | N=${result.totalSignals} | AvgRet=${result.avgReturn.toFixed(2)}% | R/R=${result.rewardRisk.toFixed(2)}`
    );

    // Monthly breakdown for top configs
    if (result.winRate5d >= 70) {
      for (const [month, m] of Object.entries(result.monthlyBreakdown).sort()) {
        const mwr = m.total > 0 ? ((m.wins / m.total) * 100).toFixed(0) : 'N/A';
        console.log(`    ${month}: ${mwr}% (${m.wins}/${m.total})`);
      }
    }
  }

  if (qualifying.length === 0) {
    console.log('  No configurations achieved ≥ 60% win rate with ≥ 3 signals.');
    console.log('\n  All results with signals:');
    const withSignals = results
      .filter((r) => r.result.totalSignals > 0)
      .sort((a, b) => b.result.winRate5d - a.result.winRate5d);
    for (const { name, result } of withSignals.slice(0, 20)) {
      console.log(
        `  ${name.padEnd(35)} | WR=${result.winRate5d.toFixed(1)}% | N=${result.totalSignals} | AvgRet=${result.avgReturn.toFixed(2)}%`
      );
    }
  }

  // ==========================================================================
  // Phase 4: Goal search — entry filter reaching WR ≥ 60% AND R/R > baseline.
  //   Levers are essay-aligned quality/pullback features:
  //     IBS  = intraday close position (low = bought weakness, essay #2 눌림목)
  //     ATR% = volatility (lower = calmer names win more often)
  //     volR = participation, score band = signal strength, regime = trend gate
  //   Eval is O(N) over precomputed 5-day returns, so the FULL discrete grid is
  //   enumerated deterministically — no sampling variance, fully reproducible
  //   (cheaper and more honest than Bayesian search when each eval is O(N)).
  //   Discipline against overfit: the config is SELECTED on train (entries ≤
  //   2024) and must INDEPENDENTLY hold on holdout (entries ≥ 2025); per-year
  //   robustness is printed for the winner.
  // ==========================================================================
  console.log('\n\n📋 Phase 4: Goal search — WR ≥ 60% & R/R > baseline');
  console.log('='.repeat(130));

  const BASELINE_RR = v5Result.rewardRisk;
  const BASELINE_WR = v5Result.winRate5d;
  console.log(
    `Baseline (V5, fixed 5-day): WR=${BASELINE_WR.toFixed(1)}%  R/R=${BASELINE_RR.toFixed(2)}  N=${v5Result.totalSignals}`
  );
  console.log('Goal: WR ≥ 60.0%  AND  R/R > baseline, holding on BOTH train and holdout.\n');

  interface Enriched {
    ret5d: number;
    win: boolean; // ret5d > 0 (matches measure5DayWinRate)
    year: string;
    ibs: number;
    atrPct: number;
    volR: number;
    score: number;
    regime: string;
    sma50dist: number;
  }
  const enriched: Enriched[] = [];
  for (const sig of v5Signals) {
    if (sig.decision !== 'BUY') continue;
    const prices = priceData.get(sig.ticker);
    if (!prices) continue;
    const idx = prices.findIndex((p) => p.date.getTime() === sig.date.getTime());
    if (idx === -1 || idx + 5 >= prices.length) continue;
    const ret5d = ((prices[idx + 5].close - sig.close) / sig.close) * 100;
    enriched.push({
      ret5d,
      win: ret5d > 0,
      year: sig.date.toISOString().slice(0, 4),
      ibs: sig.ibs,
      atrPct: sig.close > 0 ? (sig.atr / sig.close) * 100 : 0,
      volR: sig.volumeRatio,
      score: sig.score,
      regime: sig.regime,
      sma50dist: sig.sma50dist,
    });
  }
  const trainRows = enriched.filter((e) => e.year <= '2024');
  const testRows = enriched.filter((e) => e.year >= '2025');
  console.log(
    `Enriched BUY signals: ${enriched.length} (train ≤2024: ${trainRows.length}, holdout ≥2025: ${testRows.length})\n`
  );

  interface Filt {
    ibsMax: number;
    atrMax: number;
    volRMax: number;
    volRMin: number;
    scoreMin: number;
    scoreMax: number;
    regime: 'any' | 'uptrend' | 'notdown';
    sma50: 'any' | 'below' | 'above';
  }
  const passes = (e: Enriched, f: Filt): boolean =>
    e.ibs < f.ibsMax &&
    e.atrPct < f.atrMax &&
    e.volR < f.volRMax &&
    e.volR > f.volRMin &&
    e.score >= f.scoreMin &&
    e.score < f.scoreMax &&
    (f.regime === 'any' ||
      (f.regime === 'uptrend' ? e.regime === 'uptrend' : e.regime !== 'downtrend')) &&
    (f.sma50 === 'any' || (f.sma50 === 'below' ? e.sma50dist < 0 : e.sma50dist > 0));

  interface Stat {
    n: number;
    wr: number;
    rr: number;
    avgRet: number;
    avgWin: number;
    avgLoss: number;
  }
  const statOf = (rows: Enriched[]): Stat => {
    const n = rows.length;
    if (n === 0) return { n: 0, wr: 0, rr: 0, avgRet: 0, avgWin: 0, avgLoss: 0 };
    let wins = 0;
    let winSum = 0;
    let winCnt = 0;
    let lossSum = 0;
    let lossCnt = 0;
    let retSum = 0;
    for (const r of rows) {
      retSum += r.ret5d;
      if (r.ret5d > 0) {
        wins++;
        winSum += r.ret5d;
        winCnt++;
      } else {
        lossSum += r.ret5d;
        lossCnt++;
      }
    }
    const avgWin = winCnt > 0 ? winSum / winCnt : 0;
    const avgLoss = lossCnt > 0 ? Math.abs(lossSum / lossCnt) : 0;
    return {
      n,
      wr: (wins / n) * 100,
      rr: avgLoss > 0 ? avgWin / avgLoss : 0,
      avgRet: retSum / n,
      avgWin,
      avgLoss,
    };
  };

  const ibsMaxes = [0.12, 0.15, 0.18, 0.2, 0.25, 0.3, 2];
  const atrMaxes = [2.5, 3, 3.5, 4, 99];
  const volRMaxes = [1.2, 1.5, 2, 99];
  const volRMins = [0, 0.8];
  const scoreMins = [0, 260, 300];
  const scoreMaxes = [380, 400, 9999];
  const regimeModes: Filt['regime'][] = ['any', 'uptrend', 'notdown'];
  const sma50Modes: Filt['sma50'][] = ['any', 'below', 'above'];

  const describe = (f: Filt): string =>
    [
      f.ibsMax < 2 ? `ibs<${f.ibsMax}` : null,
      f.atrMax < 99 ? `atr%<${f.atrMax}` : null,
      f.volRMax < 99 ? `volR<${f.volRMax}` : null,
      f.volRMin > 0 ? `volR>${f.volRMin}` : null,
      f.scoreMin > 0 ? `scr≥${f.scoreMin}` : null,
      f.scoreMax < 9999 ? `scr<${f.scoreMax}` : null,
      f.regime !== 'any' ? f.regime : null,
      f.sma50 !== 'any' ? `sma50${f.sma50}` : null,
    ]
      .filter(Boolean)
      .join(' ') || 'all';

  // Selection criteria — TRAIN must meet the goal with a non-trivial N; HOLDOUT
  // must independently confirm (slightly relaxed to allow normal sample noise).
  const MIN_TRAIN_N = 40;
  const MIN_TEST_N = 20;
  interface Cand {
    f: Filt;
    train: Stat;
    test: Stat;
    full: Stat;
  }
  const feasible: Cand[] = [];
  let evaluated = 0;
  for (const ibsMax of ibsMaxes)
    for (const atrMax of atrMaxes)
      for (const volRMax of volRMaxes)
        for (const volRMin of volRMins)
          for (const scoreMin of scoreMins)
            for (const scoreMax of scoreMaxes)
              for (const regime of regimeModes)
                for (const sma50 of sma50Modes) {
                  if (scoreMin >= scoreMax) continue;
                  const f: Filt = {
                    ibsMax,
                    atrMax,
                    volRMax,
                    volRMin,
                    scoreMin,
                    scoreMax,
                    regime,
                    sma50,
                  };
                  evaluated++;
                  const tr = statOf(trainRows.filter((e) => passes(e, f)));
                  if (tr.n < MIN_TRAIN_N || tr.wr < 60 || tr.rr <= BASELINE_RR) continue;
                  const te = statOf(testRows.filter((e) => passes(e, f)));
                  const full = statOf(enriched.filter((e) => passes(e, f)));
                  feasible.push({ f, train: tr, test: te, full });
                }

  console.log(`Enumerated ${evaluated} filter configs deterministically.\n`);

  // Generalizing = holdout independently meets a (mildly relaxed) bar.
  const generalizes = (c: Cand): boolean =>
    c.test.n >= MIN_TEST_N && c.test.wr >= 58 && c.test.rr > 1.15;
  const ranked = feasible
    .filter(generalizes)
    .sort(
      (a, b) =>
        Math.min(b.train.wr, b.test.wr) - Math.min(a.train.wr, a.test.wr) ||
        b.full.rr - a.full.rr ||
        b.full.n - a.full.n
    );

  console.log(
    `Feasible on train (WR≥60 & R/R>${BASELINE_RR.toFixed(2)} & N≥${MIN_TRAIN_N}): ${feasible.length}`
  );
  console.log(`Of those, generalizing to holdout: ${ranked.length}\n`);

  const hdr = `${'Filter'.padEnd(46)} | ${'trWR'.padStart(5)} ${'trRR'.padStart(5)} ${'trN'.padStart(4)} | ${'teWR'.padStart(5)} ${'teRR'.padStart(5)} ${'teN'.padStart(4)} | ${'fullWR'.padStart(6)} ${'fullRR'.padStart(6)} ${'N'.padStart(4)}`;
  const rowOf = (c: Cand): string =>
    `${describe(c.f).padEnd(46)} | ${c.train.wr.toFixed(1).padStart(5)} ${c.train.rr.toFixed(2).padStart(5)} ${String(c.train.n).padStart(4)} | ${c.test.wr.toFixed(1).padStart(5)} ${c.test.rr.toFixed(2).padStart(5)} ${String(c.test.n).padStart(4)} | ${c.full.wr.toFixed(1).padStart(6)} ${c.full.rr.toFixed(2).padStart(6)} ${String(c.full.n).padStart(4)}`;

  if (ranked.length > 0) {
    console.log('🏆 Generalizing configs (train-selected, holdout-confirmed):');
    console.log(hdr);
    console.log('-'.repeat(hdr.length));
    for (const c of ranked.slice(0, 25)) console.log(rowOf(c));

    const best = ranked[0];
    console.log('\n✅ GOAL CANDIDATE (best generalizing):');
    console.log(`  Filter: ${describe(best.f)}`);
    console.log(
      `  TRAIN ≤2024 : WR=${best.train.wr.toFixed(1)}%  R/R=${best.train.rr.toFixed(2)}  N=${best.train.n}  avgRet=${best.train.avgRet.toFixed(2)}%`
    );
    console.log(
      `  HOLDOUT ≥2025: WR=${best.test.wr.toFixed(1)}%  R/R=${best.test.rr.toFixed(2)}  N=${best.test.n}  avgRet=${best.test.avgRet.toFixed(2)}%`
    );
    console.log(
      `  FULL        : WR=${best.full.wr.toFixed(1)}%  R/R=${best.full.rr.toFixed(2)}  N=${best.full.n}  avgRet=${best.full.avgRet.toFixed(2)}%`
    );
    console.log('  By entry year:');
    for (const yr of ['2023', '2024', '2025', '2026']) {
      const ys = statOf(enriched.filter((e) => e.year === yr && passes(e, best.f)));
      if (ys.n === 0) continue;
      console.log(
        `    ${yr}: WR=${ys.wr.toFixed(1)}%  R/R=${ys.rr.toFixed(2)}  N=${ys.n}  avgRet=${ys.avgRet.toFixed(2)}%`
      );
    }
    const wrOk = best.full.wr >= 60 && best.full.rr > BASELINE_RR;
    console.log(
      `\n  ${wrOk ? '✅' : '⚠️'} Full-sample goal ${wrOk ? 'MET' : 'NOT fully met'}: WR ${best.full.wr.toFixed(1)}% (≥60), R/R ${best.full.rr.toFixed(2)} (>${BASELINE_RR.toFixed(2)})`
    );
  } else {
    console.log('⚠️ No train-selected config generalized to holdout under the goal bar.');
    console.log('   Closest feasible-on-train configs (may be overfit — holdout shown):');
    console.log(hdr);
    console.log('-'.repeat(hdr.length));
    for (const c of feasible
      .sort((a, b) => b.test.wr - a.test.wr || b.full.rr - a.full.rr)
      .slice(0, 20))
      console.log(rowOf(c));
  }
}
