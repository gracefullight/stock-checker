export const CSV_DIR = 'public';

export const INDICATOR_WEIGHTS = {
  rsi: 79,
  stochastic: 76,
  bollinger: 78,
  donchian: 74,
  williamsR: 72,
  fearGreed: 50,
  macd: 75,
  sma: 60,
  ema: 65,
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
} as const;

export const BUY_THRESHOLD = 200;
export const SELL_THRESHOLD = 200;

export const DEFAULT_PIPELINE_CONFIG = {
  indicatorWeights: { ...INDICATOR_WEIGHTS },
  patternWeights: { ...PATTERN_WEIGHTS } as Record<string, number>,
  thresholds: { buy: 370, sell: SELL_THRESHOLD },
  calibration: { slope: 0.01, intercept: -1.0 },
  trendGate: {
    enabled: true,
    minConditions: 1,
    sidewaysThreshold: 3,
  },
  gradientRanges: {
    rsi: { max: 20, mid: 35, zero: 50 },
    stochK: { max: 15, mid: 25, zero: 40 },
    williamsR: { max: -85, mid: -75, zero: -55 },
    bollingerPctB: { max: 0.05, mid: 0.15, zero: 0.35 },
  },
  confluence: {
    minActive: 3,
    activationThreshold: 0.3,
  },
  reversalConfirm: {
    enabled: true,
    volumeMultiplier: 1.0,
  },
} satisfies import('@/types').PipelineConfig;

export const RISK_MULTIPLIER = 1.5;
export const REWARD_MULTIPLIER = 2;
export const TRAILING_MULTIPLIER = 1.2;
export const TRAILING_ACTIVATION_MULTIPLIER = 0.5;
