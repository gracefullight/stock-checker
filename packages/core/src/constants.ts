import type { InstitutionalConfig } from '@/types';

export const CSV_DIR = 'public';

export const INDICATOR_WEIGHTS = {
  rsi: 40,
  stochastic: 35,
  bollinger: 50,
  donchian: 85,
  williamsR: 35,
  fearGreed: 30,
  macd: 80,
  sma: 100,
  ema: 70,
  volume: 90,
} as const;

export const PATTERN_WEIGHTS = {
  ascendingTriangle: 75,
  bullishFlag: 75,
  doubleBottom: 70,
  fallingWedge: 70,
  islandReversal: 73,
  descendingTriangle: -75,
  bearishFlag: -75,
  doubleTop: -70,
  risingWedge: -70,
  headAndShoulders: -73,
  bullishPennant: 70,
  cupWithHandle: 75,
  threeRisingValleys: 72,
  ascendingScallop: 65,
  measuredMoveUp: 68,
  diamondBottom: 68,
  bearishPennant: -70,
  invertedCupWithHandle: -68,
  threeDescendingPeaks: -72,
  descendingScallop: -65,
  measuredMoveDown: -68,
  topsRectangle: -65,
} as const;

export const BUY_THRESHOLD = 200;
export const SELL_THRESHOLD = 200;

export const SECTOR_ETF_MAP: Record<string, string> = {
  Technology: 'XLK',
  Healthcare: 'XLV',
  Financials: 'XLF',
  'Consumer Discretionary': 'XLY',
  'Consumer Staples': 'XLP',
  Industrials: 'XLI',
  Energy: 'XLE',
  Materials: 'XLB',
  Utilities: 'XLU',
  'Real Estate': 'XLRE',
  'Communication Services': 'XLC',
};
export const MARKET_BENCHMARK = 'SPY';

/** BUY signals within this many trading days of earnings get a warning badge. */
export const EARNINGS_PROXIMITY_DAYS = 3;

export const DEFAULT_INSTITUTIONAL_CONFIG: InstitutionalConfig = {
  enabled: true,
  weights: {
    rsSpy: 0.3,
    rsSector: 0.25,
    vwap: 0.2,
    breakoutVol: 0.15,
    liquidity: 0.07,
    earnings: 0.03,
  },
  threshold: 0.55,
  rsLookback: { short: 63, long: 126 },
  minAvgDailyDollarVol: 5_000_000,
};

export const MEAN_REVERSION_GRADIENT_RANGES = {
  rsi: { max: 20, mid: 35, zero: 50 },
  stochK: { max: 15, mid: 25, zero: 40 },
  williamsR: { max: -85, mid: -75, zero: -55 },
  bollingerPctB: { max: 0.05, mid: 0.15, zero: 0.35 },
} as const;

export const MOMENTUM_GRADIENT_RANGES = {
  rsi: { max: 70, mid: 60, zero: 45 },
  stochK: { max: 75, mid: 60, zero: 35 },
  williamsR: { max: -20, mid: -35, zero: -55 },
  bollingerPctB: { max: 0.85, mid: 0.65, zero: 0.4 },
} as const;

export const DEFAULT_PIPELINE_CONFIG = {
  strategy: 'momentum' as const,
  indicatorWeights: { ...INDICATOR_WEIGHTS },
  patternWeights: { ...PATTERN_WEIGHTS } as Record<string, number>,
  thresholds: { buy: 280, sell: SELL_THRESHOLD },
  calibration: { slope: 0.01, intercept: -1.0 },
  trendGate: {
    enabled: true,
    minConditions: 1,
    sidewaysThreshold: 3,
  },
  gradientRanges: { ...MOMENTUM_GRADIENT_RANGES },
  confluence: {
    minActive: 2,
    activationThreshold: 0.3,
  },
  reversalConfirm: {
    enabled: true,
    volumeMultiplier: 1.0,
  },
  confidenceGate: {
    enabled: false,
    threshold: 50,
    weights: { trend: 0.25, score: 0.25, confluence: 0.25, reversal: 0.25 },
  },
  regimeFilter: {
    enabled: true,
    blockUptrend: false,
  },
  clusterFilter: {
    enabled: true,
    minGapDays: 5,
  },
  institutional: DEFAULT_INSTITUTIONAL_CONFIG,
} satisfies import('@/types').PipelineConfig;

/**
 * Default pipeline config for the 'institutional' (flow-primary) strategy.
 *
 * Key differences from DEFAULT_PIPELINE_CONFIG:
 *   - strategy: 'institutional' — routes to institutionalGradientScore
 *   - trendGate.source: 'gaussian' — regime from Gaussian Channel
 *   - institutional.enabled: true — flow components computed and blended (NOT hard-gated)
 *   - thresholds.buy: 200 — lower because oscillator seasoning is capped at 130 pts;
 *       a score of 200+ requires meaningful flow contribution
 *   - regimeFilter.blockUptrend: false — we want to BUY into uptrends
 *   - gradientRanges: momentum-style (higher oscillator readings are bullish)
 */
export const DEFAULT_INSTITUTIONAL_PIPELINE_CONFIG = {
  strategy: 'institutional' as const,
  indicatorWeights: { ...INDICATOR_WEIGHTS },
  patternWeights: { ...PATTERN_WEIGHTS } as Record<string, number>,
  thresholds: { buy: 200, sell: 130 },
  calibration: { slope: 0.01, intercept: -1.0 },
  trendGate: {
    enabled: true,
    minConditions: 1,
    sidewaysThreshold: 3,
    source: 'gaussian' as const,
  },
  gradientRanges: { ...MOMENTUM_GRADIENT_RANGES },
  confluence: {
    minActive: 1,
    activationThreshold: 0.2,
  },
  reversalConfirm: {
    enabled: false,
    volumeMultiplier: 1.0,
  },
  confidenceGate: {
    enabled: false,
    threshold: 50,
    weights: { trend: 0.25, score: 0.25, confluence: 0.25, reversal: 0.25 },
  },
  regimeFilter: {
    enabled: true,
    blockUptrend: false,
  },
  clusterFilter: {
    enabled: true,
    minGapDays: 5,
  },
  institutional: DEFAULT_INSTITUTIONAL_CONFIG,
} satisfies import('@/types').PipelineConfig;

/**
 * Entry-quality gate — the "leader pullback" (주도주 눌림목) setup from the two
 * institutional-flow essays, validated through the REAL pipeline (with
 * setup-consumed cluster semantics) on a diversified 121-ticker, 2023–2026 span:
 *
 *   rsMin 0.5            — outperforming the market AND its sector (상대강도:
 *                          leaders fall less, rise first — essay #1 §5)
 *   requireBelowSma50    — pulled back below the 50-day line: buy leaders on
 *                          weakness within a Gaussian-confirmed trend, never chase
 *   ibs<0.3              — entry bar closed in the bottom 30% of its range
 *   atr%<3.5             — calm name, not a volatility blowup
 *   volR>0.8 (no upper)  — real participation; pullback bars rarely blow off
 *   buyScore<380         — anti-parabolic cap (essay #1 §6: extension ≠ entry)
 *
 *   → 5-day WR 65.1% / R/R 1.36 / N≈63 (weakest year 58.3%)
 *     vs institutional baseline 52.5% / 1.09.
 * The same family (rs .5–.7 × with/without scoreMax) sits at 65–68% WR — a
 * stable region, not a lone overfit spike.
 */
export const DEFAULT_QUALITY_GATE = {
  enabled: true,
  ibsMax: 0.3,
  atrPctMax: 3.5,
  volRMin: 0.8,
  volRMax: 99, // effectively unbounded — see note above
  scoreMax: 380,
  rsMin: 0.5,
  requireBelowSma50: true,
};

/**
 * Institutional (flow-primary) strategy WITH the entry-quality gate enabled.
 * This is the recommended high-selectivity config: fewer, higher-quality entries
 * — the best win-rate/R-R trade-off found in backtest (~59.8% / 1.25 over 5y).
 */
export const DEFAULT_QUALITY_PIPELINE_CONFIG = {
  ...DEFAULT_INSTITUTIONAL_PIPELINE_CONFIG,
  qualityGate: DEFAULT_QUALITY_GATE,
} satisfies import('@/types').PipelineConfig;

export const RISK_MULTIPLIER = 1.5;
export const REWARD_MULTIPLIER = 2;
export const TRAILING_MULTIPLIER = 1.2;
export const TRAILING_ACTIVATION_MULTIPLIER = 0.5;
