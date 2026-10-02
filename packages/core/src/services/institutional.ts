import type { BenchmarkCandle, InstitutionalConfig, InstitutionalScore } from '@/types';

interface InstitutionalParams {
  close: number;
  highs: number[];
  lows: number[];
  closes: number[];
  /** Session dates aligned one-to-one with closes, when available. */
  tickerDates?: Date[];
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

function rsGradient(excess: number | null): number {
  if (excess === null || !Number.isFinite(excess)) return 0;
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
  longPeriod: number,
  tickerDates?: Date[]
): number | null {
  const n = tickerCloses.length;
  const lookback = Math.max(shortPeriod, longPeriod);
  if (
    !Number.isInteger(shortPeriod) ||
    !Number.isInteger(longPeriod) ||
    shortPeriod <= 0 ||
    longPeriod <= 0 ||
    n <= lookback ||
    benchCandles.length <= lookback
  )
    return null;

  const periods = [0, shortPeriod, longPeriod];
  const tickerPrices = periods.map((period) => tickerCloses[n - 1 - period]);
  let benchmarkPrices: Array<number | undefined>;
  if (tickerDates) {
    if (tickerDates.length !== n) return null;
    const dates = periods.map((period) => tickerDates[n - 1 - period]);
    if (dates.some((date) => !Number.isFinite(date.getTime()))) return null;
    const byDate = new Map(
      benchCandles
        .filter((candle) => Number.isFinite(candle.date.getTime()))
        .map((candle) => [candle.date.toISOString().slice(0, 10), candle.close])
    );
    benchmarkPrices = dates.map((date) => byDate.get(date.toISOString().slice(0, 10)));
  } else {
    benchmarkPrices = periods.map((period) => benchCandles[benchCandles.length - 1 - period].close);
  }
  if (
    [...tickerPrices, ...benchmarkPrices].some(
      (price) => price === undefined || !Number.isFinite(price) || price <= 0
    )
  )
    return null;

  const [tickerNow, tickerShort, tickerLong] = tickerPrices;
  const [benchmarkNow, benchmarkShort, benchmarkLong] = benchmarkPrices as number[];
  const shortExcess = tickerNow / tickerShort - benchmarkNow / benchmarkShort;
  const longExcess = tickerNow / tickerLong - benchmarkNow / benchmarkLong;
  return shortExcess * 0.4 + longExcess * 0.6;
}

export function calcInstitutionalScore(params: InstitutionalParams): InstitutionalScore {
  const {
    close,
    highs,
    lows,
    closes,
    tickerDates,
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

  const rsSpy = calcRS(
    closes,
    spyCandles,
    config.rsLookback.short,
    config.rsLookback.long,
    tickerDates
  );
  const rsSpyGrad = rsGradient(rsSpy);

  const rsSector = calcRS(
    closes,
    sectorCandles,
    config.rsLookback.short,
    config.rsLookback.long,
    tickerDates
  );
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
