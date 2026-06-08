import { describe, expect, it } from 'vitest';
import { calcInstitutionalScore } from '@/services/institutional';
import { DEFAULT_INSTITUTIONAL_CONFIG } from '@/constants';
import type { BenchmarkCandle } from '@/services/data-fetcher';

function makeBenchCandles(n: number, startPrice = 100, dailyReturn = 0.001): BenchmarkCandle[] {
  const candles: BenchmarkCandle[] = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    price *= 1 + dailyReturn;
    candles.push({ date: new Date(2025, 0, i + 1), close: price, volume: 1_000_000, high: price * 1.01, low: price * 0.99 });
  }
  return candles;
}

function makeTickerCloses(n: number, startPrice = 100, dailyReturn = 0.002): number[] {
  const closes: number[] = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    price *= 1 + dailyReturn;
    closes.push(price);
  }
  return closes;
}

describe('calcInstitutionalScore', () => {
  it('should pass with strong signals (RS outperformance, above VWAP, near breakout, high liquidity, earnings beat)', () => {
    const closes = makeTickerCloses(200, 100, 0.003);
    const spy = makeBenchCandles(200, 100, 0.001);
    const sector = makeBenchCandles(200, 100, 0.0008);
    const close = closes[closes.length - 1];

    const result = calcInstitutionalScore({
      close,
      highs: closes.slice(-20).map(c => c * 1.01),
      lows: closes.slice(-20).map(c => c * 0.99),
      closes,
      volumes: new Array(20).fill(500_000),
      donchUpper: close * 1.001,
      volumeRatio: 2.0,
      spyCandles: spy,
      sectorCandles: sector,
      avgDailyDollarVol: 100_000_000,
      earningsBeat: true,
      earningsEstimateUp: true,
      config: DEFAULT_INSTITUTIONAL_CONFIG,
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(DEFAULT_INSTITUTIONAL_CONFIG.threshold);
    expect(result.components.liquidity).toBe(1.0);
    expect(result.components.earnings).toBe(1.0);
    expect(result.components.breakoutVol).toBe(1.0);
  });

  it('should fail when all signals are zero', () => {
    const result = calcInstitutionalScore({
      close: 90,
      highs: new Array(20).fill(100),
      lows: new Array(20).fill(100),
      closes: new Array(200).fill(100),
      volumes: new Array(20).fill(1000),
      donchUpper: 150,
      volumeRatio: 0.5,
      spyCandles: makeBenchCandles(200, 100, 0.002),
      sectorCandles: makeBenchCandles(200, 100, 0.002),
      avgDailyDollarVol: 0,
      earningsBeat: false,
      earningsEstimateUp: false,
      config: DEFAULT_INSTITUTIONAL_CONFIG,
    });

    expect(result.passed).toBe(false);
    expect(result.components.liquidity).toBe(0);
    expect(result.components.earnings).toBe(0);
    expect(result.components.breakoutVol).toBe(0);
  });

  it('should use neutral earnings gradient (0.3) when earningsBeat is null', () => {
    const result = calcInstitutionalScore({
      close: 100,
      highs: new Array(20).fill(100),
      lows: new Array(20).fill(100),
      closes: new Array(10).fill(100),
      volumes: new Array(20).fill(1000),
      donchUpper: 150,
      volumeRatio: 0.5,
      spyCandles: [],
      sectorCandles: [],
      avgDailyDollarVol: 0,
      earningsBeat: null,
      earningsEstimateUp: null,
      config: DEFAULT_INSTITUTIONAL_CONFIG,
    });

    expect(result.components.earnings).toBe(0.3);
  });

  it('should give partial breakoutVol score when near breakout but no volume confirmation', () => {
    const close = 98.5;
    const donchUpper = 100;

    const result = calcInstitutionalScore({
      close,
      highs: new Array(20).fill(close),
      lows: new Array(20).fill(close),
      closes: [close],
      volumes: new Array(20).fill(1000),
      donchUpper,
      volumeRatio: 1.0,
      spyCandles: [],
      sectorCandles: [],
      avgDailyDollarVol: 0,
      earningsBeat: null,
      earningsEstimateUp: null,
      config: DEFAULT_INSTITUTIONAL_CONFIG,
    });

    // nearBreakout (98.5 >= 100*0.98=98) but volumeRatio < 1.5
    expect(result.components.breakoutVol).toBe(0.5);
  });

  it('should tier liquidity scores correctly', () => {
    const base = {
      close: 100,
      highs: new Array(20).fill(100),
      lows: new Array(20).fill(100),
      closes: [100],
      volumes: new Array(20).fill(1000),
      donchUpper: 200,
      volumeRatio: 0.5,
      spyCandles: [] as BenchmarkCandle[],
      sectorCandles: [] as BenchmarkCandle[],
      earningsBeat: null as boolean | null,
      earningsEstimateUp: null as boolean | null,
      config: DEFAULT_INSTITUTIONAL_CONFIG,
    };

    const r50m = calcInstitutionalScore({ ...base, avgDailyDollarVol: 50_000_001 });
    const r10m = calcInstitutionalScore({ ...base, avgDailyDollarVol: 10_000_001 });
    const r5m  = calcInstitutionalScore({ ...base, avgDailyDollarVol: 5_000_001 });
    const rLow = calcInstitutionalScore({ ...base, avgDailyDollarVol: 4_000_000 });

    expect(r50m.components.liquidity).toBe(1.0);
    expect(r10m.components.liquidity).toBe(0.7);
    expect(r5m.components.liquidity).toBe(0.4);
    expect(rLow.components.liquidity).toBe(0.0);
  });
});
