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

export interface PipelineConfig {
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
  volumeSpike: {
    enabled: boolean;
    maxVolumeRatio: number;
  };
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
  };
  confidence: number;
}
