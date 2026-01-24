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
