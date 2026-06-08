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

export const RISK_MULTIPLIER = 1.5;
export const REWARD_MULTIPLIER = 2;
export const TRAILING_MULTIPLIER = 1.2;
export const TRAILING_ACTIVATION_MULTIPLIER = 0.5;
