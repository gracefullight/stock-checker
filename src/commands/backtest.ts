/**
 * Backtest command — runs Pipeline V2 against historical price data
 * and measures 5-day directional win rate.
 */
import { MACD, RSI, Stochastic, BollingerBands, EMA, SMA, WilliamsR } from 'technicalindicators';
import { DEFAULT_PIPELINE_CONFIG } from '@/constants';
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

    const result = evaluateSignal({
      ticker,
      indicators,
      close: closes[i],
      open: data[i].open,
      fearGreed: null,
      patternScore: 0,
      recentCandles,
      recentMacdHistogram,
      config,
    });

    if (result.finalDecision !== 'HOLD') {
      signals.push({
        date: data[i].date,
        ticker,
        close: closes[i],
        decision: result.finalDecision,
        score: result.score,
        regime: result.gateResults.trend.regime,
        confluenceRatio: result.gateResults.confluence.ratio,
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
  const tickers = ['TSLA', 'PLTR', 'GOOGL', 'INTC', 'IONQ', 'UPST', 'BMNR', 'GEV', 'BE', 'OPEN', 'DLO', 'DNA', 'GLW', 'POET', 'ABCL', 'CIEN', 'RXRX'];

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

  // Test multiple configurations — aggressive parameter sweep
  const configs: { name: string; config: PipelineConfig }[] = [];

  const weightMultipliers = [1.0, 1.5];
  const thresholds = [250, 280, 300, 320, 330, 340, 350, 370, 400];
  const gradientPresets: { name: string; ranges: PipelineConfig['gradientRanges'] }[] = [
    { name: 'tight', ranges: DEFAULT_PIPELINE_CONFIG.gradientRanges },
    { name: 'std', ranges: {
      rsi: { max: 15, mid: 30, zero: 40 },
      stochK: { max: 10, mid: 20, zero: 35 },
      williamsR: { max: -90, mid: -80, zero: -60 },
      bollingerPctB: { max: 0, mid: 0.1, zero: 0.3 },
    }},
    { name: 'wide', ranges: {
      rsi: { max: 20, mid: 35, zero: 50 },
      stochK: { max: 15, mid: 25, zero: 40 },
      williamsR: { max: -85, mid: -75, zero: -55 },
      bollingerPctB: { max: 0.05, mid: 0.15, zero: 0.35 },
    }},
  ];

  for (const gp of gradientPresets) {
    for (const wm of weightMultipliers) {
      for (const threshold of thresholds) {
        for (const confMin of [3, 4, 5]) {
          for (const revEnabled of [true, false]) {
            const scaledWeights = {
              rsi: Math.round(DEFAULT_PIPELINE_CONFIG.indicatorWeights.rsi * wm),
              stochastic: Math.round(DEFAULT_PIPELINE_CONFIG.indicatorWeights.stochastic * wm),
              bollinger: Math.round(DEFAULT_PIPELINE_CONFIG.indicatorWeights.bollinger * wm),
              donchian: Math.round(DEFAULT_PIPELINE_CONFIG.indicatorWeights.donchian * wm),
              williamsR: Math.round(DEFAULT_PIPELINE_CONFIG.indicatorWeights.williamsR * wm),
              fearGreed: Math.round(DEFAULT_PIPELINE_CONFIG.indicatorWeights.fearGreed * wm),
              macd: Math.round(DEFAULT_PIPELINE_CONFIG.indicatorWeights.macd * wm),
              sma: Math.round(DEFAULT_PIPELINE_CONFIG.indicatorWeights.sma * wm),
              ema: Math.round(DEFAULT_PIPELINE_CONFIG.indicatorWeights.ema * wm),
            };
            const cfg: PipelineConfig = {
              ...DEFAULT_PIPELINE_CONFIG,
              indicatorWeights: scaledWeights,
              trendGate: { ...DEFAULT_PIPELINE_CONFIG.trendGate, minConditions: 1, enabled: true },
              gradientRanges: gp.ranges,
              confluence: { ...DEFAULT_PIPELINE_CONFIG.confluence, minActive: confMin },
              reversalConfirm: { ...DEFAULT_PIPELINE_CONFIG.reversalConfirm, enabled: revEnabled },
              thresholds: { buy: threshold, sell: threshold },
            };
            const name = `${gp.name} w${wm} C≥${confMin} R=${revEnabled ? 'Y' : 'N'} Th=${threshold}`;
            configs.push({ name, config: cfg });
          }
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
