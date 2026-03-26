/**
 * Backtest command — runs Pipeline V2 against historical price data
 * and measures 5-day directional win rate.
 */
import { MACD, RSI, Stochastic, BollingerBands, EMA, SMA, WilliamsR } from 'technicalindicators';
import { DEFAULT_PIPELINE_CONFIG } from '@/constants';
import { detectPatterns } from '@/services/patterns';
import { evaluateSignal } from '@/services/pipeline';
import { DataLoader } from '@/optimization/data-loader';
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
}

function buildIndicatorsAtBar(
  closes: number[], highs: number[], lows: number[], volumes: number[],
  rsiArr: number[], stochArr: { k: number; d: number }[],
  bbArr: { lower: number; upper: number; middle: number }[],
  sma20Arr: number[], ema20Arr: number[], sma50Arr: number[], sma200Arr: number[],
  williamsArr: number[], atrArr: number[],
  donchLowerArr: number[], donchUpperArr: number[],
  volMaArr: number[], i: number,
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

function runBacktestForTicker(
  data: { date: Date; open: number; high: number; low: number; close: number; volume: number }[],
  ticker: string,
  config: PipelineConfig,
): BacktestSignal[] {
  if (data.length < 210) return [];

  const closes = data.map(d => d.close);
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);
  const volumes = data.map(d => d.volume);

  // Pre-compute indicators
  const rsi2Arr = RSI.calculate({ values: closes, period: 2 });
  const rsiArr = RSI.calculate({ values: closes, period: 14 });
  const stochArr = Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
  const bbArr = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  const macdArr = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: true, SimpleMASignal: true });
  const sma20Arr = SMA.calculate({ values: closes, period: 20 });
  const ema20Arr = EMA.calculate({ values: closes, period: 20 });
  const sma50Arr = SMA.calculate({ values: closes, period: 50 });
  const sma200Arr = SMA.calculate({ values: closes, period: 200 });
  const williamsArr = WilliamsR.calculate({ high: highs, low: lows, close: closes, period: 14 });

  // ATR
  const atrArr: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 14) { atrArr.push(0); continue; }
    let sum = 0;
    for (let j = i - 13; j <= i; j++) {
      sum += Math.max(highs[j] - lows[j], Math.abs(highs[j] - closes[j - 1]), Math.abs(lows[j] - closes[j - 1]));
    }
    atrArr.push(sum / 14);
  }

  // Donchian
  const donchLowerArr: number[] = [];
  const donchUpperArr: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 20) { donchLowerArr.push(lows[i]); donchUpperArr.push(highs[i]); continue; }
    donchLowerArr.push(Math.min(...lows.slice(i - 20, i)));
    donchUpperArr.push(Math.max(...highs.slice(i - 20, i)));
  }

  // Volume MA
  const volMaArr: number[] = [];
  for (let i = 0; i < volumes.length; i++) {
    if (i < 20) { volMaArr.push(volumes[i] || 1); continue; }
    volMaArr.push(volumes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20);
  }

  // MACD histogram array
  const macdHistArr = macdArr.map(m => {
    const mv = (m as { MACD?: number }).MACD ?? 0;
    const sv = (m as { signal?: number }).signal ?? 0;
    return mv - sv;
  });

  const signals: BacktestSignal[] = [];
  const recentBuyDates: Date[] = [];

  for (let i = 205; i < data.length; i++) {
    const indicators = buildIndicatorsAtBar(
      closes, highs, lows, volumes,
      rsiArr, stochArr as { k: number; d: number }[],
      bbArr as { lower: number; upper: number; middle: number }[],
      sma20Arr, ema20Arr, sma50Arr, sma200Arr,
      williamsArr, atrArr, donchLowerArr, donchUpperArr, volMaArr, i,
    );
    if (!indicators) continue;

    const recentCandles: CandleData[] = [];
    for (let j = Math.max(0, i - 2); j <= i; j++) {
      recentCandles.push({ open: data[j].open, close: data[j].close, high: data[j].high, low: data[j].low, volume: data[j].volume });
    }

    const histStart = Math.max(0, (i - 26) - 4);
    const histEnd = i - 26 + 1;
    const recentMacdHistogram = histEnd > 0 ? macdHistArr.slice(histStart, histEnd) : [0];

    // Detect chart patterns
    const pw = Math.min(i + 1, 50);
    const { score: patternScore } = detectPatterns(
      { highs: highs.slice(i - pw + 1, i + 1), lows: lows.slice(i - pw + 1, i + 1), closes: closes.slice(i - pw + 1, i + 1) },
      config.patternWeights,
    );

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
        sma50dist: indicators.sma50 ? (closes[i] - indicators.sma50) / indicators.sma50 * 100 : 0,
        sma200dist: indicators.sma200 ? (closes[i] - indicators.sma200) / indicators.sma200 * 100 : 0,
        rsiDelta: i >= 3 && rsiArr[i - 14] != null && rsiArr[i - 14 - 3] != null ? rsiArr[i - 14] - rsiArr[i - 14 - 3] : 0,
        priceDelta: i >= 3 ? (closes[i] - closes[i - 3]) / closes[i - 3] * 100 : 0,
        ibs: (highs[i] - lows[i]) > 0 ? (closes[i] - lows[i]) / (highs[i] - lows[i]) : 0.5,
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
  allData: Map<string, { date: Date; close: number }[]>,
): WinRateResult {
  let wins = 0;
  let total = 0;
  const returns: number[] = [];
  const monthly: Record<string, { wins: number; total: number }> = {};

  for (const sig of signals) {
    if (sig.decision !== 'BUY') continue;

    const prices = allData.get(sig.ticker);
    if (!prices) continue;

    const idx = prices.findIndex(p => p.date.getTime() === sig.date.getTime());
    if (idx === -1 || idx + 5 >= prices.length) continue;

    const futurePrice = prices[idx + 5].close;
    const ret = (futurePrice - sig.close) / sig.close * 100;
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

  const winReturns = returns.filter(r => r > 0);
  const lossReturns = returns.filter(r => r <= 0);
  const avgWin = winReturns.length > 0 ? winReturns.reduce((a, b) => a + b, 0) / winReturns.length : 0;
  const avgLoss = lossReturns.length > 0 ? Math.abs(lossReturns.reduce((a, b) => a + b, 0) / lossReturns.length) : 0;

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
  };
}

export async function backtest() {
  const tickers = [
    // Original
    'TSLA', 'PLTR', 'GOOGL', 'INTC', 'IONQ', 'UPST', 'GEV', 'BE', 'OPEN', 'DLO', 'DNA', 'GLW', 'POET', 'ABCL', 'CIEN', 'RXRX', 'AVGO', 'HOOD',
    // Mega cap
    'AAPL', 'MSFT', 'AMZN', 'NVDA', 'META', 'NFLX',
    // Semiconductor
    'AMD', 'QCOM', 'MU', 'MRVL', 'SMCI', 'ARM',
    // Software/Cloud
    'CRM', 'SNOW', 'DDOG', 'NET', 'CRWD', 'ZS', 'PANW',
    // EV/Energy
    'RIVN', 'LCID', 'ENPH', 'SEDG', 'FSLR',
    // Biotech/Health
    'MRNA', 'CRSP', 'NVAX',
    // Fintech
    'SQ', 'COIN', 'SOFI', 'AFRM',
    // Others
    'SHOP', 'ROKU', 'SNAP', 'PINS', 'U', 'RBLX', 'UBER', 'ABNB', 'DASH',
  ];

  console.log('Loading historical data for', tickers.length, 'tickers...');
  const allData = new Map<string, { date: Date; open: number; high: number; low: number; close: number; volume: number }[]>();

  for (const ticker of tickers) {
    try {
      const data = await DataLoader.loadHistoricalData(ticker, 1095);
      if (data.length >= 210) {
        allData.set(ticker, data);
        console.log(`  ${ticker}: ${data.length} bars (${data[0].date.toISOString().slice(0, 10)} ~ ${data[data.length - 1].date.toISOString().slice(0, 10)})`);
      } else {
        console.log(`  ${ticker}: ${data.length} bars (skipped, < 210)`);
      }
    } catch { /* skip */ }
  }

  console.log(`Loaded data for ${allData.size} tickers\n`);

  // Price data for win rate measurement
  const priceData = new Map<string, { date: Date; close: number }[]>();
  for (const [ticker, data] of allData) {
    priceData.set(ticker, data.map(d => ({ date: d.date, close: d.close })));
  }

  // Phase 1: Diagnostic — analyze all signals from best config
  const baseConfig: PipelineConfig = {
    ...DEFAULT_PIPELINE_CONFIG,
    patternWeights: Object.fromEntries(Object.keys(DEFAULT_PIPELINE_CONFIG.patternWeights).map(k => [k, 0])),
    trendGate: { ...DEFAULT_PIPELINE_CONFIG.trendGate, minConditions: 1, enabled: true },
    reversalConfirm: { ...DEFAULT_PIPELINE_CONFIG.reversalConfirm, enabled: false },
    thresholds: { buy: 370, sell: 200 },
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
      const idx = prices.findIndex(p => p.date.getTime() === sig.date.getTime());
      if (idx === -1 || idx + 5 >= prices.length) continue;
      const futurePrice = prices[idx + 5].close;
      const ret5d = (futurePrice - sig.close) / sig.close * 100;

      // Get detailed indicators for this bar
      const closes = data.slice(0, data.findIndex(d => d.date.getTime() === sig.date.getTime()) + 1).map(d => d.close);
      const barIdx = closes.length - 1;

      diagSignals.push({
        ...sig,
        ret5d,
        win: futurePrice > sig.close,
      });
    }
  }

  diagSignals.sort((a, b) => a.date.getTime() - b.date.getTime());

  console.log(`${'Date'.padEnd(12)} ${'Ticker'.padEnd(6)} ${'Scr'.padStart(4)} ${'IBS'.padStart(5)} ${'R2c'.padStart(5)} ${'ATRd'.padStart(5)} ${'COs'.padStart(4)} ${'VolR'.padStart(5)} ${'Ret5d'.padStart(7)} ${'W'.padStart(2)}`);
  console.log('-'.repeat(65));
  for (const s of diagSignals) {
    const dateStr = s.date.toISOString().slice(0, 10);
    console.log(`${dateStr.padEnd(12)} ${s.ticker.padEnd(6)} ${s.score.toFixed(0).padStart(4)} ${s.ibs.toFixed(2).padStart(5)} ${s.rsi2cumul.toFixed(0).padStart(5)} ${s.atrDistance.toFixed(1).padStart(5)} ${String(s.consecutiveOversold).padStart(4)} ${s.volumeRatio.toFixed(1).padStart(5)} ${s.ret5d.toFixed(2).padStart(6)}% ${(s.win ? 'W' : 'L').padStart(2)}`);
  }

  const wins = diagSignals.filter(s => s.win);
  const losses = diagSignals.filter(s => !s.win);
  console.log(`\nWins: ${wins.length}, Losses: ${losses.length}`);
  if (losses.length > 0) {
    console.log('\n🔴 Failed signals analysis:');
    for (const s of losses) {
      console.log(`  ${s.date.toISOString().slice(0, 10)} ${s.ticker} close=${s.close.toFixed(2)} score=${s.score.toFixed(0)} ret=${s.ret5d.toFixed(2)}% regime=${s.regime} confR=${s.confluenceRatio.toFixed(2)}`);
    }
    console.log('\n🟢 Winning signals stats:');
    console.log(`  Avg score: ${(wins.reduce((a, s) => a + s.score, 0) / wins.length).toFixed(0)}`);
    console.log(`  Avg confR: ${(wins.reduce((a, s) => a + s.confluenceRatio, 0) / wins.length).toFixed(2)}`);
    console.log('\n🔴 Losing signals stats:');
    console.log(`  Avg score: ${(losses.reduce((a, s) => a + s.score, 0) / losses.length).toFixed(0)}`);
    console.log(`  Avg confR: ${(losses.reduce((a, s) => a + s.confluenceRatio, 0) / losses.length).toFixed(2)}`);
  }

  // Phase 2: New filter experiments based on diagnostic
  console.log('\n\n📋 Phase 2: Post-hoc filter experiments');
  console.log('='.repeat(130));

  // Apply post-hoc filters to the base signal set
  type PostFilter = (sig: typeof diagSignals[0], allSigs: typeof diagSignals) => boolean;

  const postFilters: { name: string; filter: PostFilter }[] = [
    { name: 'baseline (no filter)', filter: () => true },
    // Regime filter: exclude uptrend (counterintuitive but data-driven)
    { name: 'regime≠uptrend', filter: (s) => s.regime !== 'uptrend' },
    // Anti-perfect confluence: confR=1.0 might mean free-fall
    { name: 'confR<1.0', filter: (s) => s.confluenceRatio < 1.0 },
    // Combined
    { name: 'regime≠uptrend + confR<1.0', filter: (s) => s.regime !== 'uptrend' && s.confluenceRatio < 1.0 },
    // Score cap: extremely high scores may indicate crashes
    { name: 'score<400', filter: (s) => s.score < 400 },
    { name: 'score<390', filter: (s) => s.score < 390 },
    // Consecutive skip: if same ticker had BUY within 5 days, skip
    { name: 'no-cluster-5d', filter: (s, all) => {
      const prev = all.filter(x => x.ticker === s.ticker && x.date < s.date && (s.date.getTime() - x.date.getTime()) < 5 * 86400000);
      return prev.length === 0;
    }},
    // Consecutive skip 10 days
    { name: 'no-cluster-10d', filter: (s, all) => {
      const prev = all.filter(x => x.ticker === s.ticker && x.date < s.date && (s.date.getTime() - x.date.getTime()) < 10 * 86400000);
      return prev.length === 0;
    }},
    // Only take if downtrend + no cluster 5d
    { name: 'regime≠up + no-clust-5d', filter: (s, all) => {
      if (s.regime === 'uptrend') return false;
      const prev = all.filter(x => x.ticker === s.ticker && x.date < s.date && (s.date.getTime() - x.date.getTime()) < 5 * 86400000);
      return prev.length === 0;
    }},
    // Same-day multi-signal check: if ≥3 tickers signal same day, skip
    { name: 'no-multi-day(≥3)', filter: (s, all) => {
      const sameDay = all.filter(x => x.date.getTime() === s.date.getTime());
      return sameDay.length < 3;
    }},
    // Regime≠uptrend + score<400
    { name: 'regime≠up + score<400', filter: (s) => s.regime !== 'uptrend' && s.score < 400 },
    // ATR-based volatility filter: skip high-volatility (ATR > X% of price)
    { name: 'atr<4%', filter: (s) => (s.atr / s.close * 100) < 4 },
    { name: 'atr<3.5%', filter: (s) => (s.atr / s.close * 100) < 3.5 },
    { name: 'atr<3%', filter: (s) => (s.atr / s.close * 100) < 3 },
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
    { name: 'ibs<0.30', filter: (s) => s.ibs < 0.30 },
    { name: 'ibs<0.25', filter: (s) => s.ibs < 0.25 },
    { name: 'ibs<0.20', filter: (s) => s.ibs < 0.20 },
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
    { name: 'ibs<0.25+atrD>1.5+volR<2', filter: (s) => s.ibs < 0.25 && s.atrDistance > 1.5 && s.volumeRatio < 2.0 },
    { name: 'ibs<0.20+atrD>1.5+volR<2', filter: (s) => s.ibs < 0.20 && s.atrDistance > 1.5 && s.volumeRatio < 2.0 },
    { name: 'atrD>2+volR<2+consOD≥2', filter: (s) => s.atrDistance > 2.0 && s.volumeRatio < 2.0 && s.consecutiveOversold >= 2 },
    { name: 'atrD>1.5+volR<1.5+ibs<0.25', filter: (s) => s.atrDistance > 1.5 && s.volumeRatio < 1.5 && s.ibs < 0.25 },
    { name: 'atrD>2+volR<1.5', filter: (s) => s.atrDistance > 2.0 && s.volumeRatio < 1.5 },
    { name: 'score≥375+atrD>1.5+volR<2', filter: (s) => s.score >= 375 && s.atrDistance > 1.5 && s.volumeRatio < 2.0 },
    { name: 'scr≥375+volR<2+ibs<0.25', filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.ibs < 0.25 },
    { name: 'scr≥375+volR<2+ibs<0.30', filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.ibs < 0.30 },
    { name: 'scr≥375+volR<2+ibs<0.40', filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.ibs < 0.40 },
    { name: 'scr≥375+volR<2+consOD≥2', filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.consecutiveOversold >= 2 },
    { name: 'scr≥375+volR<2+rsi2c<20', filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.rsi2cumul < 20 },
    { name: 'scr≥375+volR<2+rsi2c<15', filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.rsi2cumul < 15 },
    { name: 'all:scr375+vR2+ibs25+atrD1.5', filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.ibs < 0.25 && s.atrDistance > 1.5 },
    { name: 'all:scr375+vR2+consOD2+atrD2', filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.consecutiveOversold >= 2 && s.atrDistance > 2.0 },
  ];

  // Multi-period win rate analysis
  console.log('\n📊 Holding period analysis:');
  console.log('-'.repeat(70));
  for (const period of [1, 2, 3, 5, 7, 10, 15, 20]) {
    let wins = 0, total = 0;
    for (const sig of diagSignals) {
      if (sig.decision !== 'BUY') continue;
      const prices = priceData.get(sig.ticker);
      if (!prices) continue;
      const idx = prices.findIndex(p => p.date.getTime() === sig.date.getTime());
      if (idx === -1 || idx + period >= prices.length) continue;
      total++;
      if (prices[idx + period].close > sig.close) wins++;
    }
    const wr = total > 0 ? (wins / total * 100).toFixed(1) : 'N/A';
    console.log(`  ${String(period).padStart(2)}d: ${wr}% (${wins}/${total})`);
  }

  // volR<1.5 subset multi-period
  console.log('\n📊 volR<1.5 holding period:');
  console.log('-'.repeat(70));
  const lowVol = diagSignals.filter(s => s.decision === 'BUY' && s.volumeRatio < 1.5);
  for (const period of [1, 2, 3, 5, 7, 10, 15, 20]) {
    let wins = 0, total = 0;
    for (const sig of lowVol) {
      const prices = priceData.get(sig.ticker);
      if (!prices) continue;
      const idx = prices.findIndex(p => p.date.getTime() === sig.date.getTime());
      if (idx === -1 || idx + period >= prices.length) continue;
      total++;
      if (prices[idx + period].close > sig.close) wins++;
    }
    const wr = total > 0 ? (wins / total * 100).toFixed(1) : 'N/A';
    console.log(`  ${String(period).padStart(2)}d: ${wr}% (${wins}/${total})`);
  }

  console.log(`${'Filter'.padEnd(35)} | ${'WinRate'.padStart(8)} | ${'Signals'.padStart(8)} | ${'Wins'.padStart(5)} | ${'Losses'.padStart(7)} | ${'AvgRet'.padStart(8)}`);
  console.log('-'.repeat(85));

  for (const { name, filter } of postFilters) {
    const filtered = diagSignals.filter((s) => filter(s, diagSignals));
    const w = filtered.filter(s => s.win).length;
    const l = filtered.filter(s => !s.win).length;
    const total = w + l;
    const wr = total > 0 ? (w / total * 100).toFixed(1) + '%' : 'N/A';
    const avg = filtered.length > 0 ? (filtered.reduce((a, s) => a + s.ret5d, 0) / filtered.length).toFixed(2) + '%' : 'N/A';
    console.log(`${name.padEnd(35)} | ${wr.padStart(8)} | ${String(total).padStart(8)} | ${String(w).padStart(5)} | ${String(l).padStart(7)} | ${avg.padStart(8)}`);
  }

  // Phase 3: Grid search with structural filters
  console.log('\n\n📋 Phase 3: Grid search');
  console.log('='.repeat(130));

  const configs: { name: string; config: PipelineConfig }[] = [];

  for (const threshold of [370, 400, 430, 460, 500]) {
    for (const maxVolR of [1.5, 2.0, 2.5, 99]) {
      for (const confMin of [3, 4, 5]) {
        for (const rev of [true, false]) {
          const cfg: PipelineConfig = {
            ...baseConfig,
            confluence: { ...baseConfig.confluence, minActive: confMin },
            thresholds: { buy: threshold, sell: 200 },
            volumeSpike: { enabled: maxVolR < 99, maxVolumeRatio: maxVolR },
            reversalConfirm: { enabled: rev, volumeMultiplier: 1.0 },
          };
          const name = `Th=${threshold} vR<${maxVolR} C≥${confMin} R=${rev ? 'Y' : 'N'}`;
          configs.push({ name, config: cfg });
        }
      }
    }
  }

  console.log(`Testing ${configs.length} configurations...\n`);
  console.log(`${'Config'.padEnd(35)} | ${'WinRate'.padStart(8)} | ${'Signals'.padStart(8)} | ${'AvgRet'.padStart(8)} | ${'R/R'.padStart(6)} | ${'Sig/Mo'.padStart(6)}`);
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
      console.log(`${name.padEnd(35)} | ${wr.padStart(8)} | ${sig.padStart(8)} | ${avg.padStart(8)} | ${rr.padStart(6)} | ${spm.padStart(6)}`);
    }
  }

  // Find best config with ≥ 75% win rate and reasonable signal count
  console.log('\n' + '='.repeat(85));
  console.log('🏆 Best configurations (win rate ≥ 60%, signals ≥ 3):');
  console.log('='.repeat(85));

  const qualifying = results
    .filter(r => r.result.winRate5d >= 60 && r.result.totalSignals >= 5)
    .sort((a, b) => b.result.winRate5d - a.result.winRate5d || b.result.totalSignals - a.result.totalSignals);

  for (const { name, result } of qualifying.slice(0, 20)) {
    console.log(`  ${name.padEnd(35)} | WR=${result.winRate5d.toFixed(1)}% | N=${result.totalSignals} | AvgRet=${result.avgReturn.toFixed(2)}% | R/R=${result.rewardRisk.toFixed(2)}`);

    // Monthly breakdown for top configs
    if (result.winRate5d >= 70) {
      for (const [month, m] of Object.entries(result.monthlyBreakdown).sort()) {
        const mwr = m.total > 0 ? (m.wins / m.total * 100).toFixed(0) : 'N/A';
        console.log(`    ${month}: ${mwr}% (${m.wins}/${m.total})`);
      }
    }
  }

  if (qualifying.length === 0) {
    console.log('  No configurations achieved ≥ 60% win rate with ≥ 3 signals.');
    console.log('\n  All results with signals:');
    const withSignals = results
      .filter(r => r.result.totalSignals > 0)
      .sort((a, b) => b.result.winRate5d - a.result.winRate5d);
    for (const { name, result } of withSignals.slice(0, 20)) {
      console.log(`  ${name.padEnd(35)} | WR=${result.winRate5d.toFixed(1)}% | N=${result.totalSignals} | AvgRet=${result.avgReturn.toFixed(2)}%`);
    }
  }
}
