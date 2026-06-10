import type { BacktestMetrics } from '@stock-checker/core/src/optimization/types';
import type { PipelineConfig } from '@stock-checker/core/src/types';

// JSON-serialized candle shapes as returned by /api/screener/:ticker/backtest-data.
export interface SerializedCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SerializedBenchmarkCandle {
  date: string;
  close: number;
  volume: number;
  high: number;
  low: number;
}

export interface BacktestDataPayload {
  ticker: string;
  candles: SerializedCandle[];
  spy: SerializedBenchmarkCandle[];
  sector: { etf: string; candles: SerializedBenchmarkCandle[] } | null;
}

export interface WinRateSummary {
  winRate5d: number;
  totalSignals: number;
  wins: number;
  avgReturn: number;
  avgWin: number;
  avgLoss: number;
  rewardRisk: number;
  signalsPerMonth: number;
}

export interface EquityPointDTO {
  date: string;
  equity: number;
}

export interface TradeDTO {
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
}

export interface SignalMarkerDTO {
  date: string;
  decision: 'BUY' | 'SELL';
  close: number;
  score: number;
}

export interface RunResultDTO {
  winRate: WinRateSummary;
  equity: {
    points: EquityPointDTO[];
    totalReturn: number;
    maxDrawdown: number;
  };
  trades: TradeDTO[];
  signals: SignalMarkerDTO[];
}

export type BacktestWorkerRequest =
  | { type: 'run'; data: BacktestDataPayload; config: PipelineConfig }
  | { type: 'optimize'; data: BacktestDataPayload; nTrials: number };

export type BacktestWorkerResponse =
  | { type: 'run-result'; result: RunResultDTO }
  | { type: 'progress'; trial: number; nTrials: number; bestValue: number }
  | {
      type: 'optimize-result';
      bestParams: PipelineConfig;
      bestValue: number;
      metrics: BacktestMetrics;
    }
  | { type: 'error'; message: string };
