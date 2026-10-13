export interface CliOptions {
  tickers: string[];
  slackWebhook?: string;
  sort: 'asc' | 'desc';
  /** `ticker` (default) orders by symbol; `decision` orders BUY, SELL, HOLD, then score descending. */
  sortBy?: 'ticker' | 'decision';
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
  sector?: string | null;
  /** ISO date (YYYY-MM-DD) of the next scheduled earnings report. */
  nextEarningsDate?: string | null;
  /** Trading days until next earnings; negative when the date has passed. */
  daysToEarnings?: number | null;
  marketCap?: number | null;
  dayChangePct?: number | null;
  /** Composite BUY/SELL scores behind `score`, for downstream rendering. */
  buyScore?: number;
  sellScore?: number;
  /** Gate that produced a HOLD on the BUY path; null for BUY/SELL decisions. */
  blockedBy?: SignalGateId | null;
  /** Every gate check evaluated for this decision, with observed value and limit. */
  checks?: SignalCheck[];
  /** Cluster-window state when the cluster filter blocked the entry. */
  cluster?: ClusterState | null;
  /**
   * Live earnings evidence shown as context only. The decision is scored at the
   * validated neutral earnings value, so this never changes BUY/HOLD.
   */
  earningsEvidence?: { beat: boolean | null; estimateUp: boolean | null };
  /** Sector ETF used for relative strength (validated map first, then Yahoo sector alias). */
  sectorEtf?: string | null;
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

/** Benchmark (SPY / sector ETF) daily candle used for relative-strength inputs. */
export interface BenchmarkCandle {
  date: Date;
  close: number;
  volume: number;
  high: number;
  low: number;
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

/** Identifier of the gate that decided a HOLD on the BUY path (in evaluation order). */
export type SignalGateId =
  | 'score'
  | 'eligibility'
  | 'trend'
  | 'regime'
  | 'cluster'
  | 'quality'
  | 'institutional'
  | 'confluence'
  | 'reversal'
  | 'confidence'
  | 'sell-regime'
  | 'insufficient-history';

/** One evaluated gate clause: the observed value against its configured limit. */
export interface SignalCheck {
  gate: SignalGateId;
  id: string;
  passed: boolean;
  value: number | string | boolean | null;
  limit: number | string | boolean | null;
  comparator: '<' | '<=' | '>' | '>=' | '==' | 'in';
}

/** Cluster-window state when an earlier setup still blocks a new entry. */
export interface ClusterState {
  /** ISO date (YYYY-MM-DD) of the most recent consumed setup. */
  lastSetupDate: string;
  /** ISO date of the first session that clears the window; null when unknown for session gaps. */
  nextEligibleDate: string | null;
  gapUnit: 'calendar' | 'sessions';
  minGap: number;
}

/** 'leader-pullback' is an alias of the shipped 'institutional' strategy name. */
export type StrategyName = 'mean-reversion' | 'momentum' | 'institutional' | 'leader-pullback';

export interface PipelineConfig {
  strategy: StrategyName;
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
    /**
     * Which evaluated bars consume the cluster window. Absent = 'all-setups'
     * (the validated rule: every BUY and every quality-blocked score-fire).
     * 'buys-only' consumes only executed BUYs; 'pullback-setups' consumes BUYs
     * plus quality-blocked bars that were already pullbacks (close below SMA50
     * with both relative-strength clauses passing). Variants are research
     * options until a pre-registered comparison passes.
     */
    consume?: 'all-setups' | 'buys-only' | 'pullback-setups';
    /** Gap unit for minGapDays. Absent = 'calendar' (the validated rule). */
    gapUnit?: 'calendar' | 'sessions';
  };
  /**
   * Entry-quality (pullback) gate — essay-aligned. When enabled, a qualifying BUY
   * is downgraded to HOLD unless the entry bar is a calm pullback with steady,
   * non-blowoff participation:
   *   - IBS  = (close − low) / (high − low) < ibsMax  (closed near the low = bought weakness)
   *   - ATR% = atr / close * 100        < atrPctMax    (calmer name)
   *   - volRMin < volumeRatio < volRMax  (real but not climactic/blowoff volume)
   * Thresholds express the setup rules; historical performance claims are
   * withdrawn pending validation with causal data and next-session execution.
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
    /**
     * Leader filter (essay #1: 상대강도 — leaders fall less, rise first). Requires
     * BOTH institutional rsSpy and rsSector component gradients ≥ rsMin, i.e. the
     * name is outperforming the market AND its sector. Undefined = off.
     */
    rsMin?: number;
    /**
     * Pullback filter (essay #1: buy leaders on weakness, not extension). When
     * true, the entry bar's close must be BELOW the 50-day SMA — a pullback
     * within a (Gaussian-confirmed) uptrend rather than a chase. Undefined/false = off.
     */
    requireBelowSma50?: boolean;
    /**
     * Market kill-switch (essay #2 applied at the index level): require the SPY
     * Gaussian Channel to be green before any BUY. Individual-name pullback
     * entries lose their edge in market-wide liquidity panics (2020-03); this
     * blocks them. Only blocks when the market regime is explicitly known to be
     * down (callers that cannot supply `marketUptrend` are never blocked).
     */
    requireMarketUptrend?: boolean;
    /**
     * Stage filter (essay #1: price vs key MAs): require the entry close to be
     * ABOVE the 200-day SMA — pullbacks within a long-term uptrend only. Skipped
     * when SMA200 is unavailable. Undefined/false = off.
     */
    requireAboveSma200?: boolean;
    /**
     * Accumulation filter (essay #1: VWAP — institutions execute against it).
     * Requires the institutional vwap component gradient ≥ vwapMin, i.e. the
     * name keeps absorbing supply above the session average price. Undefined = off.
     */
    vwapMin?: number;
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
  /**
   * True when a score-qualified BUY was downgraded to HOLD by the entry-quality
   * gate. Callers managing a cluster window should treat this as "setup
   * consumed": the setup fired and was judged once — later bars of the same
   * deteriorating cluster must not re-trigger (a pullback that keeps closing
   * weak for days is a breakdown, not an entry).
   */
  qualityBlocked?: boolean;
  /** Gate that produced this HOLD (undefined for BUY/SELL). */
  blockedBy?: SignalGateId;
  /** Every clause evaluated on this bar, in gate order; disabled gates add no entries. */
  checks?: SignalCheck[];
  /** Present when the cluster filter blocked the entry. */
  cluster?: ClusterState;
}
