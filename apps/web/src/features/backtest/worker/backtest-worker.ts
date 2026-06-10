/// <reference lib="webworker" />
import { optimizeWithData, runBacktest } from '@stock-checker/core/src/browser';
import type {
  BacktestDataPayload,
  BacktestWorkerRequest,
  BacktestWorkerResponse,
  RunResultDTO,
} from '@/features/backtest/types/protocol';

declare const self: DedicatedWorkerGlobalScope;

function post(message: BacktestWorkerResponse): void {
  self.postMessage(message);
}

function revive(payload: BacktestDataPayload) {
  return {
    candles: payload.candles.map((c) => ({ ...c, date: new Date(c.date) })),
    spy: payload.spy.map((c) => ({ ...c, date: new Date(c.date) })),
    sector: payload.sector?.candles.map((c) => ({ ...c, date: new Date(c.date) })) ?? [],
  };
}

self.onmessage = (event: MessageEvent<BacktestWorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'run') {
      const { candles, spy, sector } = revive(msg.data);
      const result = runBacktest(msg.data.ticker, candles, spy, sector, msg.config);
      if (!result) {
        post({ type: 'error', message: 'Not enough data (need 210+ bars)' });
        return;
      }
      const dto: RunResultDTO = {
        winRate: {
          winRate5d: result.winRate.winRate5d,
          totalSignals: result.winRate.totalSignals,
          wins: result.winRate.wins,
          avgReturn: result.winRate.avgReturn,
          avgWin: result.winRate.avgWin,
          avgLoss: result.winRate.avgLoss,
          rewardRisk: result.winRate.rewardRisk,
          signalsPerMonth: result.winRate.signalsPerMonth,
        },
        equity: {
          points: result.equityCurve.points,
          totalReturn: result.equityCurve.totalReturn,
          maxDrawdown: result.equityCurve.maxDrawdown,
        },
        trades: result.equityCurve.trades,
        signals: result.signals
          .filter((s) => s.decision !== 'HOLD')
          .map((s) => ({
            date: s.date.toISOString().slice(0, 10),
            decision: s.decision as 'BUY' | 'SELL',
            close: s.close,
            score: s.score,
          })),
      };
      post({ type: 'run-result', result: dto });
      return;
    }

    if (msg.type === 'optimize') {
      const { candles, spy, sector } = revive(msg.data);
      const result = optimizeWithData(
        candles,
        msg.nTrials,
        ({ trial, nTrials, bestValue }) => {
          if (trial % 5 === 0 || trial === nTrials) {
            post({ type: 'progress', trial, nTrials, bestValue });
          }
        },
        { spy, sector }
      );
      post({
        type: 'optimize-result',
        bestParams: result.bestParams,
        bestValue: result.bestValue,
        metrics: result.metrics,
      });
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : 'Worker error' });
  }
};
