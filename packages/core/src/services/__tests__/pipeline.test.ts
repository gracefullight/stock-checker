import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INSTITUTIONAL_CONFIG,
  DEFAULT_INSTITUTIONAL_PIPELINE_CONFIG,
  DEFAULT_PIPELINE_CONFIG,
  MEAN_REVERSION_GRADIENT_RANGES,
} from '@/constants';
import { evaluateSignal } from '@/services/pipeline';
import type { BenchmarkCandle, CandleData, IndicatorValues, PipelineConfig } from '@/types';

function makeIndicators(overrides: Partial<IndicatorValues> = {}): IndicatorValues {
  return {
    rsi: 50,
    stochasticK: 50,
    bbLower: 90,
    bbUpper: 110,
    donchLower: 85,
    donchUpper: 115,
    williamsR: -50,
    atr: 5,
    macd: 0,
    macdSignal: 0,
    macdHistogram: 0,
    sma20: 100,
    ema20: 100,
    sma50: 98,
    sma200: 95,
    volumeRatio: 1.2,
    ...overrides,
  };
}

function makeCandle(open: number, close: number): CandleData {
  return {
    open,
    close,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    volume: 1000,
  };
}

const config: PipelineConfig = {
  ...DEFAULT_PIPELINE_CONFIG,
  strategy: 'mean-reversion',
  indicatorWeights: {
    ...DEFAULT_PIPELINE_CONFIG.indicatorWeights,
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
  },
  gradientRanges: { ...MEAN_REVERSION_GRADIENT_RANGES },
  thresholds: { buy: 370, sell: 200 },
  confluence: { minActive: 3, activationThreshold: 0.3 },
  regimeFilter: { enabled: false, blockUptrend: false },
  clusterFilter: { enabled: false, minGapDays: 5 },
  institutional: { ...DEFAULT_INSTITUTIONAL_CONFIG, enabled: false },
};

describe('evaluateSignal', () => {
  it('should return BUY when all gates pass (deeply oversold + uptrend + confirmation)', () => {
    const indicators = makeIndicators({
      rsi: 12,
      stochasticK: 8,
      williamsR: -92,
      bbLower: 100,
      bbUpper: 120,
      donchLower: 98,
      donchUpper: 125,
      sma20: 96,
      ema20: 96,
      sma50: 102,
      sma200: 95,
      volumeRatio: 1.5,
    });
    const recentCandles = [
      makeCandle(100, 95), // day[-2]
      makeCandle(95, 100), // day[-1]: bullish confirmation
      makeCandle(100, 98), // day[0]
    ];
    const result = evaluateSignal({
      ticker: 'TEST',
      indicators,
      close: 98,
      open: 100,
      fearGreed: 15,
      patternScore: 70,
      recentCandles,
      recentMacdHistogram: [-0.5, -0.2, 0.1],
      config,
    });
    expect(result.finalDecision).toBe('BUY');
    expect(result.gateResults.trend.passed).toBe(true);
    expect(result.gateResults.confluence.passed).toBe(true);
    expect(result.gateResults.reversal.status).toBe('confirmed');
  });

  it('should return HOLD when trend gate blocks (downtrend)', () => {
    const indicators = makeIndicators({
      rsi: 12,
      stochasticK: 8,
      williamsR: -92,
      bbLower: 100,
      bbUpper: 120,
      donchLower: 98,
      donchUpper: 125,
      sma50: 90,
      sma200: 110, // downtrend: SMA50 < SMA200, close < SMA200
      volumeRatio: 1.5,
    });
    const recentCandles = [makeCandle(100, 95), makeCandle(95, 100), makeCandle(100, 98)];
    const result = evaluateSignal({
      ticker: 'TEST',
      indicators,
      close: 85,
      open: 90,
      fearGreed: 15,
      patternScore: 70,
      recentCandles,
      recentMacdHistogram: [-0.5, -0.2, 0.1],
      config,
    });
    expect(result.finalDecision).toBe('HOLD');
    expect(result.gateResults.trend.passed).toBe(false);
  });

  it('should return HOLD when confluence check fails (too few active indicators)', () => {
    // Only RSI is deeply oversold, others neutral → confluence fails
    const indicators = makeIndicators({
      rsi: 12,
      stochasticK: 50,
      williamsR: -50,
      sma50: 102,
      sma200: 95,
      volumeRatio: 1.2,
    });
    const recentCandles = [makeCandle(100, 95), makeCandle(95, 100), makeCandle(100, 98)];
    const result = evaluateSignal({
      ticker: 'TEST',
      indicators,
      close: 100,
      open: 100,
      fearGreed: 50,
      patternScore: 0,
      recentCandles,
      recentMacdHistogram: [0.1, 0.2, -0.1],
      config,
    });
    expect(result.finalDecision).toBe('HOLD');
  });

  it('should return HOLD when reversal confirmation fails (bearish candle)', () => {
    const indicators = makeIndicators({
      rsi: 12,
      stochasticK: 8,
      williamsR: -92,
      bbLower: 100,
      bbUpper: 120,
      donchLower: 98,
      donchUpper: 125,
      sma20: 96,
      ema20: 96,
      sma50: 102,
      sma200: 95,
      volumeRatio: 1.5,
    });
    // day[-1] is bearish → reversal rejected
    const recentCandles = [
      makeCandle(100, 95),
      makeCandle(95, 90), // bearish!
      makeCandle(90, 88),
    ];
    const result = evaluateSignal({
      ticker: 'TEST',
      indicators,
      close: 98,
      open: 100,
      fearGreed: 15,
      patternScore: 70,
      recentCandles,
      recentMacdHistogram: [-0.5, -0.2, 0.1],
      config,
    });
    expect(result.finalDecision).toBe('HOLD');
    expect(result.gateResults.reversal.status).toBe('rejected');
  });

  it('should return HOLD with neutral indicators', () => {
    const indicators = makeIndicators();
    const recentCandles = [makeCandle(100, 100), makeCandle(100, 100), makeCandle(100, 100)];
    const result = evaluateSignal({
      ticker: 'TEST',
      indicators,
      close: 100,
      open: 100,
      fearGreed: 50,
      patternScore: 0,
      recentCandles,
      recentMacdHistogram: [0, 0, 0],
      config,
    });
    expect(result.finalDecision).toBe('HOLD');
  });

  it('should bypass trend gate when disabled', () => {
    const noTrendConfig = {
      ...config,
      trendGate: { enabled: false, minConditions: 2, sidewaysThreshold: 2 },
    };
    const indicators = makeIndicators({
      rsi: 12,
      stochasticK: 8,
      williamsR: -92,
      bbLower: 100,
      bbUpper: 120,
      donchLower: 98,
      donchUpper: 125,
      sma20: 96,
      ema20: 96,
      sma50: 90,
      sma200: 110, // downtrend, but gate disabled
      volumeRatio: 1.5,
    });
    const recentCandles = [makeCandle(100, 95), makeCandle(95, 100), makeCandle(100, 98)];
    const result = evaluateSignal({
      ticker: 'TEST',
      indicators,
      close: 98,
      open: 100,
      fearGreed: 15,
      patternScore: 70,
      recentCandles,
      recentMacdHistogram: [-0.5, -0.2, 0.1],
      config: noTrendConfig,
    });
    // Should not be blocked by trend
    expect(result.gateResults.trend.passed).toBe(true);
  });
});

// --- C4: Blend-not-hard-gate for 'institutional' strategy ---
//
// Asserts: under strategy='institutional', a signal with STRONG flow but
// instResult.passed===false still returns finalDecision='BUY'.
// Under strategy='momentum' (legacy hard-gate), the same weak instResult blocks it.
describe('evaluateSignal — institutional blend-not-hard-gate', () => {
  // Use SMA-based trend (not gaussian) by not passing allCloses,
  // so trend gate resolves from SMA50 > SMA200 uptrend.
  const instConfig: PipelineConfig = {
    ...DEFAULT_INSTITUTIONAL_PIPELINE_CONFIG,
    // Override trendGate to SMA-based so we don't need full allCloses for gaussian
    trendGate: {
      enabled: true,
      minConditions: 1,
      sidewaysThreshold: 3,
    },
    // Ensure institutional enabled so calcInstitutionalScore runs
    institutional: { ...DEFAULT_INSTITUTIONAL_CONFIG, enabled: true },
  };

  // Close = 105, donchUpper = 106, so close >= donchUpper * 0.98 (breakout zone)
  // volumeRatio = 1.6 >= 1.5 → breakoutVolGrad = 1.0
  // Closes trending up so close > vwap20 and volumeRatio > 1.0 → vwapGrad = 1.0
  // No spyCandles / sectorCandles (length < rsLookback.long + 1 = 127) → rsSpy = rsSector = 0
  // earningsBeat = null → earningsGrad = 0.3
  // avgDailyDollarVol = 0 → liquidityGrad = 0
  //
  // instResult.score = 0*0.3 + 0*0.25 + 1.0*0.2 + 1.0*0.15 + 0*0.07 + 0.3*0.03 = 0.359 < 0.55
  // → instResult.passed = false
  //
  // institutionalGradientScore buyScore = rsSpy(0)*120 + rsSector(0)*90 + vwap(1)*90
  //   + breakoutVol(1)*110 + liquidity(0)*40 + earnings(0.3)*30 + oscillators
  //   = 0 + 0 + 90 + 110 + 0 + 9 + oscillators = 209+ → >= 200 threshold → BUY

  const close = 105;
  // Build allCloses: 20 bars ascending so vwap < close and recent candles show uptrend
  const allCloses = Array.from({ length: 20 }, (_, i) => 90 + i);
  // allHighs / allLows / allVolumes matching the close series
  const allHighs = allCloses.map((c) => c + 2);
  const allLows = allCloses.map((c) => c - 2);
  const allVolumes = Array.from({ length: 20 }, () => 1_000_000);

  const indicators = makeIndicators({
    rsi: 65,
    stochasticK: 65,
    williamsR: -30,
    donchLower: 85,
    donchUpper: 106, // close(105) >= 106*0.98=103.88 → nearBreakout
    sma20: 98,
    ema20: 98,
    sma50: 102,
    sma200: 90,
    volumeRatio: 1.6, // >= 1.5 → breakoutVolGrad=1.0 and vwapGrad=1.0
  });

  const recentCandles: CandleData[] = [
    makeCandle(100, 103),
    makeCandle(103, 104),
    makeCandle(104, 105),
  ];

  // Short spy/sector candles: fewer than rsLookback.long+1 = 127 → rsSpy=rsSector=0
  const shortBenchmark: BenchmarkCandle[] = Array.from({ length: 10 }, (_, i) => ({
    date: new Date(2024, 0, i + 1),
    open: 400,
    high: 402,
    low: 398,
    close: 400,
    volume: 10_000_000,
  }));

  it('should return BUY under institutional strategy even when instResult.passed is false', () => {
    const result = evaluateSignal({
      ticker: 'INST_TEST',
      indicators,
      close,
      open: 104,
      fearGreed: 50,
      patternScore: 0,
      recentCandles,
      recentMacdHistogram: [-0.2, -0.1, 0.1], // MACD crossover → extra seasoning
      config: instConfig,
      allCloses,
      allHighs,
      allLows,
      allVolumes,
      spyCandles: shortBenchmark,
      sectorCandles: shortBenchmark,
      avgDailyDollarVol: 0,
      earningsBeat: null,
      earningsEstimateUp: null,
    });

    // instResult.passed should be false (score < 0.55 because rsSpy=rsSector=0, no liquidity)
    expect(result.gateResults.institutional.passed).toBe(false);
    // BUT institutional strategy blends flow into score, so BUY is still reached
    expect(result.finalDecision).toBe('BUY');
  });

  it('should return HOLD under momentum strategy with the same weak instResult (hard-gate blocks)', () => {
    // Momentum config with institutional enabled (hard-gate) and same flow scenario
    const momentumConfig: PipelineConfig = {
      ...DEFAULT_PIPELINE_CONFIG,
      strategy: 'momentum',
      institutional: { ...DEFAULT_INSTITUTIONAL_CONFIG, enabled: true },
      trendGate: { enabled: true, minConditions: 1, sidewaysThreshold: 3 },
      reversalConfirm: { ...DEFAULT_PIPELINE_CONFIG.reversalConfirm, enabled: false },
      confidenceGate: { ...DEFAULT_PIPELINE_CONFIG.confidenceGate, enabled: false },
      regimeFilter: { enabled: false, blockUptrend: false },
      clusterFilter: { enabled: false, minGapDays: 5 },
    };

    const result = evaluateSignal({
      ticker: 'MOM_TEST',
      indicators,
      close,
      open: 104,
      fearGreed: 50,
      patternScore: 0,
      recentCandles,
      recentMacdHistogram: [-0.2, -0.1, 0.1],
      config: momentumConfig,
      allCloses,
      allHighs,
      allLows,
      allVolumes,
      spyCandles: shortBenchmark,
      sectorCandles: shortBenchmark,
      avgDailyDollarVol: 0,
      earningsBeat: null,
      earningsEstimateUp: null,
    });

    // Hard-gate: instResult.passed===false blocks BUY for momentum strategy
    expect(result.gateResults.institutional.passed).toBe(false);
    expect(result.finalDecision).toBe('HOLD');
  });

  // --- Entry-quality (pullback) gate (Gate 1.7) ---
  // Reuses the same BUY scenario and toggles ONLY the quality gate, so the test
  // isolates the gate's effect from the scoring path. The entry bar here is
  // makeCandle(104, 105): high=106, low=103, close=105 → IBS=(105-103)/(106-103)≈0.67;
  // atr=5, close=105 → ATR%≈4.76; volumeRatio=1.6.
  it('preserves BUY when the quality gate is enabled but the entry bar qualifies', () => {
    const lenientGate: PipelineConfig = {
      ...instConfig,
      // Lenient thresholds the bar satisfies: ibs 0.67<0.7, atr% 4.76<5, 0.8<1.6<2
      qualityGate: { enabled: true, ibsMax: 0.7, atrPctMax: 5, volRMin: 0.8, volRMax: 2 },
    };
    const result = evaluateSignal({
      ticker: 'Q_PASS',
      indicators,
      close,
      open: 104,
      fearGreed: 50,
      patternScore: 0,
      recentCandles,
      recentMacdHistogram: [-0.2, -0.1, 0.1],
      config: lenientGate,
      allCloses,
      allHighs,
      allLows,
      allVolumes,
      spyCandles: shortBenchmark,
      sectorCandles: shortBenchmark,
      avgDailyDollarVol: 0,
    });
    expect(result.finalDecision).toBe('BUY');
    expect(result.qualityBlocked).toBeUndefined();
  });

  it('downgrades BUY to HOLD when the entry bar fails the quality gate', () => {
    const strictGate: PipelineConfig = {
      ...instConfig,
      // Shipped DEFAULT_QUALITY_GATE thresholds: the bar fails ibs (0.67≮0.3) and atr% (4.76≮3.5)
      qualityGate: { enabled: true, ibsMax: 0.3, atrPctMax: 3.5, volRMin: 0.8, volRMax: 2 },
    };
    const result = evaluateSignal({
      ticker: 'Q_FAIL',
      indicators,
      close,
      open: 104,
      fearGreed: 50,
      patternScore: 0,
      recentCandles,
      recentMacdHistogram: [-0.2, -0.1, 0.1],
      config: strictGate,
      allCloses,
      allHighs,
      allLows,
      allVolumes,
      spyCandles: shortBenchmark,
      sectorCandles: shortBenchmark,
      avgDailyDollarVol: 0,
    });
    expect(result.finalDecision).toBe('HOLD');
    // Blocked by the quality gate, not by trend/score — the trend gate still passed.
    expect(result.gateResults.trend.passed).toBe(true);
    // Setup-consumed marker: callers must record this date in their cluster
    // window so the same deteriorating setup cannot re-trigger on later bars.
    expect(result.qualityBlocked).toBe(true);
  });

  // --- SELL = exit discipline, regime-gated for the institutional strategy ---
  // A distribution-day scenario (heavy volume below VWAP + Donchian breakdown +
  // MACD dead cross → sellScore ≥ 130). Backtest showed these SELLs have
  // NEGATIVE directional edge inside an intact uptrend (selling leaders), so
  // they must be suppressed to HOLD unless the trend itself is broken.
  describe('institutional SELL regime gate', () => {
    // 40 descending closes → price sits below VWAP20 (vwap gradient ~0) and the
    // bar closes near the Donchian low.
    const fallCloses = Array.from({ length: 40 }, (_, i) => 140 - i);
    const fallHighs = fallCloses.map((c) => c + 2);
    const fallLows = fallCloses.map((c) => c - 2);
    const fallVolumes = Array.from({ length: 40 }, () => 1_000_000);

    const bearishIndicators = (overrides: Partial<IndicatorValues>) =>
      makeIndicators({
        rsi: 45,
        stochasticK: 30,
        williamsR: -70,
        bbLower: 90,
        bbUpper: 200, // %B ≈ 0.09 → no bollinger sell contribution
        donchLower: 95,
        donchUpper: 200, // donch position ≈ 0.05 → full breakdown contribution (50)
        volumeRatio: 1.6, // ≥1.5 + below VWAP → distribution contribution (72)
        ...overrides,
      });

    const sellScenario = (indicators: IndicatorValues) =>
      evaluateSignal({
        ticker: 'SELL_TEST',
        indicators,
        close: 100,
        open: 101,
        fearGreed: 50,
        patternScore: 0,
        recentCandles: [makeCandle(105, 103), makeCandle(103, 101), makeCandle(101, 100)],
        recentMacdHistogram: [0.2, 0.1, -0.1], // dead cross → macd sell contribution (35)
        config: instConfig,
        allCloses: fallCloses,
        allHighs: fallHighs,
        allLows: fallLows,
        allVolumes: fallVolumes,
        spyCandles: shortBenchmark,
        sectorCandles: shortBenchmark,
        avgDailyDollarVol: 0,
      });

    it('fires SELL when the trend regime is downtrend (exit discipline)', () => {
      // close 100 < sma50 120 < sma200 150 → 0/3 conditions → downtrend
      const result = sellScenario(bearishIndicators({ sma50: 120, sma200: 150 }));
      expect(result.gateResults.trend.regime).toBe('downtrend');
      expect(result.finalDecision).toBe('SELL');
    });

    it('suppresses the same SELL to HOLD inside an intact uptrend', () => {
      // close 100 > sma50 95 > sma200 90 → 3/3 conditions → uptrend
      const result = sellScenario(bearishIndicators({ sma50: 95, sma200: 90 }));
      expect(result.gateResults.trend.regime).toBe('uptrend');
      // sellScore still qualifies numerically, but the regime gate blocks it —
      // never sell a leader inside an intact trend on a panic day.
      expect(result.sellScore).toBeGreaterThanOrEqual(instConfig.thresholds.sell);
      expect(result.finalDecision).toBe('HOLD');
    });
  });
});
