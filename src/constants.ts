export const CSV_DIR = 'public';

export const INDICATOR_WEIGHTS = {
  rsi: 79,
  stochastic: 76,
  bollinger: 78,
  donchian: 74,
  williamsR: 72,
  fearGreed: 50,
} as const;

export const PATTERN_WEIGHTS = {
  ascendingTriangle: 75,
  bullishFlag: 75,
  doubleBottom: 70,
  fallingWedge: 70,
  islandReversal: 73,
} as const;

export const BUY_THRESHOLD = 200;
export const SELL_THRESHOLD = 200;

export const RISK_MULTIPLIER = 1.5;
export const REWARD_MULTIPLIER = 2;
export const TRAILING_MULTIPLIER = 1.2;
export const TRAILING_ACTIVATION_MULTIPLIER = 0.5;