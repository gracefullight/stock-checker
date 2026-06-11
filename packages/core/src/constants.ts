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
 * setup-consumed cluster semantics) on a diversified 546-ticker, 8-year span
 * (entry years 2019–2026, incl. the 2020 crash and 2022 bear), NET of a 10bps
 * round-trip transaction cost:
 *
 *   rsMin 0.7            — STRONGLY outperforming the market AND its sector
 *                          (상대강도: "is it stronger than everything else?" —
 *                          essay #1 §5)
 *   requireBelowSma50    — pulled back below the 50-day line: buy leaders on
 *                          weakness within a Gaussian-confirmed trend, never chase
 *   ibs<0.2              — entry bar closed in the bottom 20% of its range:
 *                          a DEEP intraday flush, not a mild dip (the ibs
 *                          family improved monotonically on every universe
 *                          tested: 0.3 → 0.25 → 0.2)
 *   atr%<3.5             — calm name, not a volatility blowup
 *   volR>0.8 (no upper)  — real participation; pullback bars rarely blow off
 *   buyScore<400         — anti-parabolic cap (essay #1 §6: extension ≠ entry)
 *
 *   → 5-day WR 60.4% / R/R 1.28 / N=225 / avgRet 1.08% (train ≤2024:
 *     58.6%/1.19, holdout ≥2025: 69.2%/2.35; by year 2019 66% / 2020 62% /
 *     2021 61% / 2022 55% / 2023 52% / 2024 55% / 2025 65% / 2026 74% —
 *     every entry year ≥ 50%) vs institutional baseline 51.3% / 1.05 —
 *     statistically significant (z≈2.6, p≈0.004).
 *     The legacy V7 gate (rs .5, ibs .3, scr<380) sits at 56.3% / 1.32 / N=476.
 *
 * Cap-tier scope: this is a LARGE-CAP strategy — ~90% of gate signals are
 * $10B+ names. On mid caps the gate rarely fires and the WR edge disappears
 * (≈52% vs a 50.5% mid baseline, though winners run bigger); the ungated
 * small-cap baseline is outright negative (46% WR). Trade it on liquid
 * large caps.
 *
 * Falsification record (hard-won rule #2 — universe shapes conclusions): on
 * the original 122-ticker growth-heavy universe this family printed
 * 66–72% WR with R/R 1.45–1.75 (N=46–66). Expanding to 408+ tickers collapsed
 * those numbers — the 70%+ readings were small-N universe artifacts, NOT edge.
 * Likewise `requireMarketUptrend` (SPY Gaussian green) and `requireAboveSma200`
 * HELPED on 122 tickers but consistently HURT at scale, matching the published
 * stock-level evidence — both remain available as gate params but are NOT
 * part of the default.
 */
export const DEFAULT_QUALITY_GATE = {
  enabled: true,
  ibsMax: 0.2,
  atrPctMax: 3.5,
  volRMin: 0.8,
  volRMax: 99, // effectively unbounded — see note above
  scoreMax: 400,
  rsMin: 0.7,
  requireBelowSma50: true,
};

/**
 * Institutional (flow-primary) strategy WITH the entry-quality gate enabled.
 * This is the recommended high-selectivity config: fewer, higher-quality entries
 * — 60.4% WR / 1.28 R/R / N=225 over 8y on a 546-ticker universe, net of the
 * round-trip transaction cost (see DEFAULT_QUALITY_GATE for the full record).
 */
export const DEFAULT_QUALITY_PIPELINE_CONFIG = {
  ...DEFAULT_INSTITUTIONAL_PIPELINE_CONFIG,
  qualityGate: DEFAULT_QUALITY_GATE,
} satisfies import('@/types').PipelineConfig;

/**
 * Round-trip transaction cost (percent of notional) deducted from every
 * backtested trade: ~5bps slippage per side on liquid US large caps, zero
 * commission. Backtest WR/R-R numbers are NET of this unless stated otherwise.
 */
export const DEFAULT_ROUND_TRIP_COST_PCT = 0.1;

export const RISK_MULTIPLIER = 1.5;
export const REWARD_MULTIPLIER = 2;
export const TRAILING_MULTIPLIER = 1.2;
export const TRAILING_ACTIVATION_MULTIPLIER = 0.5;
