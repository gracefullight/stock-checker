export interface CliOptions {
  tickers: string[];
  slackWebhook?: string;
  sort: 'asc' | 'desc';
  portfolioAction?: string;
  portfolioTicker?: string;
  fundamentals?: boolean;
  news?: boolean;
  options?: boolean;
  dividends?: boolean;
  earnings?: boolean;
  format?: 'csv' | 'json';
}

export interface IndicatorValues {
  rsi: number;
  stochasticK: number;
  bbLower: number;
  bbUpper: number;
  donchLower: number;
  donchUpper: number;
  williamsR: number;
  atr: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  sma20: number;
  ema20: number;
  sma50: number;
  sma200: number;
  volumeRatio: number;
}

export interface PatternResult {
  score: number;
  patterns: string[];
}

export interface TickerResult {
  ticker: string;
  /** Human-readable company name (longName/shortName), when available. */
  name?: string;
  date: string;
  close: number;
  volume: number;
  rsi: number;
  stochasticK: number;
  bbLower: number;
  bbUpper: number;
  donchLower: number;
  donchUpper: number;
  williamsR: number;
  fearGreed: number | null;
  patterns: string[];
  score: number;
  opinion: string;
  atr: number;
  stopLoss: number;
  takeProfit: number;
  trailingStop: number;
  trailingStart: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  sma20: number;
  ema20: number;
  buyProbability?: number;
  sellProbability?: number;
  holdProbability?: number;
  confidence?: string;
  sma50?: number;
  sma200?: number;
  volumeRatio?: number;
  trendRegime?: string;
  confluenceRatio?: number;
  institutionalScore?: number;
  institutionalPassed?: boolean;
}

export interface PredictionRecord {
  ticker: string;
  date: string;
  opinion: string;
  score: number;
  buyProbability: number;
  sellProbability: number;
  holdProbability: number;
  confidence: string;
  close: number;
  indicators: {
    rsi: number;
    stochasticK: number;
    williamsR: number;
    patternScore: number;
    macd: number;
    macdSignal: number;
    macdHistogram: number;
    sma20: number;
    ema20: number;
  };
}

// Pipeline V2 Types

export interface CandleData {
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface TrendGateConfig {
  enabled: boolean;
  minConditions: number;
  sidewaysThreshold: number;
  /** Trend source for the pipeline.  'sma' = classic SMA50/200 cross; 'gaussian' = Gaussian Channel filter. Default: 'sma' */
  source?: 'sma' | 'gaussian';
}

export interface TrendGateResult {
  passed: boolean;
  regime: 'uptrend' | 'downtrend' | 'sideways' | 'unknown';
  strength: number;
  reason: string;
}

export interface GradientRanges {
  rsi: { max: number; mid: number; zero: number };
  stochK: { max: number; mid: number; zero: number };
  williamsR: { max: number; mid: number; zero: number };
  bollingerPctB: { max: number; mid: number; zero: number };
}

export interface ConfluenceConfig {
  minActive: number;
  activationThreshold: number;
}

export interface ConfluenceResult {
  passed: boolean;
  activeIndicators: number;
  totalIndicators: number;
  ratio: number;
}

export interface ReversalConfig {
  enabled: boolean;
  volumeMultiplier: number;
}

export interface ReversalConfirmation {
  status: 'confirmed' | 'rejected';
  trigger: 'bullish_candle' | 'volume_spike' | 'both' | null;
}

export interface InstitutionalWeights {
  rsSpy: number;
  rsSector: number;
  vwap: number;
  breakoutVol: number;
  liquidity: number;
  earnings: number;
}

export interface InstitutionalConfig {
  enabled: boolean;
  weights: InstitutionalWeights;
  threshold: number;
  rsLookback: { short: number; long: number };
  minAvgDailyDollarVol: number;
}

export interface InstitutionalScore {
  score: number;
  passed: boolean;
  components: {
    rsSpy: number;
    rsSector: number;
    vwap: number;
    breakoutVol: number;
    liquidity: number;
    earnings: number;
  };
}

export interface PipelineConfig {
  strategy: 'mean-reversion' | 'momentum' | 'institutional';
  indicatorWeights: {
    rsi: number;
    stochastic: number;
    bollinger: number;
    donchian: number;
    williamsR: number;
    fearGreed: number;
    macd: number;
    sma: number;
    ema: number;
    volume: number;
  };
  patternWeights: Record<string, number>;
  thresholds: { buy: number; sell: number };
  calibration: { slope: number; intercept: number };
  trendGate: TrendGateConfig;
  gradientRanges: GradientRanges;
  confluence: ConfluenceConfig;
  reversalConfirm: ReversalConfig;
  confidenceGate: {
    enabled: boolean;
    threshold: number;
    weights: { trend: number; score: number; confluence: number; reversal: number };
  };
  regimeFilter: {
    enabled: boolean;
    blockUptrend: boolean;
  };
  clusterFilter: {
    enabled: boolean;
    minGapDays: number;
  };
  /**
   * Entry-quality (pullback) gate — essay-aligned. When enabled, a qualifying BUY
   * is downgraded to HOLD unless the entry bar is a calm pullback with steady,
   * non-blowoff participation:
   *   - IBS  = (close − low) / (high − low) < ibsMax  (closed near the low = bought weakness)
   *   - ATR% = atr / close * 100        < atrPctMax    (calmer name)
   *   - volRMin < volumeRatio < volRMax  (real but not climactic/blowoff volume)
   * Backtested (5-day directional, train ≤2024 / holdout ≥2025) to lift win rate
   * to ~65% with R/R ~1.5, both well above the institutional baseline (53% / 1.21).
   */
  qualityGate?: {
    enabled: boolean;
    ibsMax: number;
    atrPctMax: number;
    volRMin: number;
    volRMax: number;
    /**
     * Upper buyScore cap (essay #1: avoid chasing parabolic/blowoff names — the
     * highest-scoring extended setups have the worst forward reward/risk). A BUY
     * with buyScore ≥ scoreMax is downgraded to HOLD. Undefined = no cap.
     */
    scoreMax?: number;
  };
  institutional: InstitutionalConfig;
}

export interface PipelineResult {
  ticker: string;
  finalDecision: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  buyScore: number;
  sellScore: number;
  gateResults: {
    trend: TrendGateResult;
    confluence: ConfluenceResult;
    reversal: ReversalConfirmation;
    institutional: InstitutionalScore;
  };
  confidence: number;
}
