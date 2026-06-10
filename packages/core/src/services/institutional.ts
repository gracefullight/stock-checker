import type { BenchmarkCandle, InstitutionalConfig, InstitutionalScore } from '@/types';

interface InstitutionalParams {
  close: number;
  highs: number[];
  lows: number[];
  closes: number[];
  volumes: number[];
  donchUpper: number;
  volumeRatio: number;
  spyCandles: BenchmarkCandle[];
  sectorCandles: BenchmarkCandle[];
  avgDailyDollarVol: number;
  earningsBeat: boolean | null;
  earningsEstimateUp: boolean | null;
  config: InstitutionalConfig;
}

function rsGradient(excess: number): number {
  if (excess > 0.1) return 1.0;
  if (excess > 0.05) return 0.75;
  if (excess > 0) return 0.5;
  if (excess > -0.05) return 0.25;
  return 0.0;
}

function calcRS(
  tickerCloses: number[],
  benchCandles: BenchmarkCandle[],
  shortPeriod: number,
  longPeriod: number
): number {
  const n = tickerCloses.length;
  if (n < longPeriod + 1 || benchCandles.length < longPeriod + 1) return 0;

  const benchCloses = benchCandles.slice(-n).map((c) => c.close);

  const ret = (arr: number[], period: number) =>
    arr.length > period
      ? (arr[arr.length - 1] - arr[arr.length - 1 - period]) / arr[arr.length - 1 - period]
      : 0;

  const tRet13 = ret(tickerCloses, shortPeriod);
  const bRet13 = ret(benchCloses, shortPeriod);
  const tRet26 = ret(tickerCloses, longPeriod);
  const bRet26 = ret(benchCloses, longPeriod);

  const rs13 = tRet13 - bRet13;
  const rs26 = tRet26 - bRet26;
  return rs13 * 0.4 + rs26 * 0.6;
}

export function calcInstitutionalScore(params: InstitutionalParams): InstitutionalScore {
  const {
    close,
    highs,
    lows,
    closes,
    volumes,
    donchUpper,
    volumeRatio,
    spyCandles,
    sectorCandles,
    avgDailyDollarVol,
    earningsBeat,
    earningsEstimateUp,
    config,
  } = params;

  const rsSpy = calcRS(closes, spyCandles, config.rsLookback.short, config.rsLookback.long);
  const rsSpyGrad = rsGradient(rsSpy);

  const rsSector = calcRS(closes, sectorCandles, config.rsLookback.short, config.rsLookback.long);
  const rsSectorGrad = rsGradient(rsSector);

  const n = Math.min(highs.length, lows.length, closes.length, volumes.length, 20);
  const h = highs.slice(-n),
    l = lows.slice(-n),
    c = closes.slice(-n),
    v = volumes.slice(-n);
  let typVolSum = 0,
    volSum = 0;
  for (let i = 0; i < n; i++) {
    const typPrice = (h[i] + l[i] + c[i]) / 3;
    typVolSum += typPrice * v[i];
    volSum += v[i];
  }
  const vwap20 = volSum > 0 ? typVolSum / volSum : close;
  let vwapGrad: number;
  if (close > vwap20 && volumeRatio > 1.0) vwapGrad = 1.0;
  else if (close > vwap20) vwapGrad = 0.6;
  else vwapGrad = 0.0;

  const nearBreakout = close >= donchUpper * 0.98;
  const volumeConfirmed = volumeRatio >= 1.5;
  let breakoutVolGrad: number;
  if (nearBreakout && volumeConfirmed) breakoutVolGrad = 1.0;
  else if (nearBreakout) breakoutVolGrad = 0.5;
  else breakoutVolGrad = 0.0;

  let liquidityGrad: number;
  if (avgDailyDollarVol >= 50_000_000) liquidityGrad = 1.0;
  else if (avgDailyDollarVol >= 10_000_000) liquidityGrad = 0.7;
  else if (avgDailyDollarVol >= 5_000_000) liquidityGrad = 0.4;
  else liquidityGrad = 0.0;

  let earningsGrad: number;
  if (earningsBeat === null) earningsGrad = 0.3;
  else if (earningsBeat && earningsEstimateUp) earningsGrad = 1.0;
  else if (earningsBeat) earningsGrad = 0.6;
  else earningsGrad = 0.0;

  const w = config.weights;
  const score =
    rsSpyGrad * w.rsSpy +
    rsSectorGrad * w.rsSector +
    vwapGrad * w.vwap +
    breakoutVolGrad * w.breakoutVol +
    liquidityGrad * w.liquidity +
    earningsGrad * w.earnings;

  return {
    score,
    passed: score >= config.threshold,
    components: {
      rsSpy: rsSpyGrad,
      rsSector: rsSectorGrad,
      vwap: vwapGrad,
      breakoutVol: breakoutVolGrad,
      liquidity: liquidityGrad,
      earnings: earningsGrad,
    },
  };
}
