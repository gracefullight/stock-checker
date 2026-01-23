export interface CliOptions {
  tickers: string[];
  slackWebhook?: string;
  sort: 'asc' | 'desc';
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
}
