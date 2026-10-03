import { DEFAULT_ROUND_TRIP_COST_PCT } from '@/constants';
import {
  type BacktestSignal,
  type Candle,
  type EvaluationWindow,
  getFixedHoldTrade,
  measure5DayWinRate,
} from '@/optimization/engine';
import { calculateLongRiskLevels } from '@/services/risk-levels';

export interface AtrBarrierObservation {
  stopLoss: number;
  takeProfit: number;
  stopTouched: boolean;
  targetTouched: boolean;
  firstTouch: 'stop' | 'target' | 'ambiguous' | 'neither';
  firstTouchDate: string | null;
  firstTouchFill: number | null;
  openingGap: boolean;
}

export interface HistoricalOutcomesReport {
  period: { from: string | null; to: string | null };
  method: {
    horizonSessions: 5;
    entry: 'next-session-open';
    fixedHoldExit: 'fifth-session-close';
    roundTripCostBps: number;
    sampleUnit: 'completed BUY observations; overlap permitted';
    atrBasis: 'signal-session ATR with actual next-session open';
  };
  buySignals: number;
  excluded: { incomplete: number; invalidExecution: number; invalidAtrOrCandles: number };
  fixedHold: {
    samples: number;
    wins: number;
    winRatePct: number | null;
    averageNetReturnPct: number | null;
    rewardRisk: number | null;
  };
  atrBarriers: {
    samples: number;
    stopTouched: number;
    targetTouched: number;
    bothTouched: number;
    stopTouchRatePct: number | null;
    targetTouchRatePct: number | null;
    stopFirst: number;
    targetFirst: number;
    ambiguousFirstTouch: number;
    neitherTouched: number;
    gapStopFirst: number;
    gapTargetFirst: number;
  };
}

const sessionDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Fixed barriers anchored to the observed entry open. Touches are measured over
 * all five sessions, even after a first hit; they are not executed-trade wins.
 * Opening prices establish order before the unknown intraday high/low path.
 */
export function observeAtrBarriers(
  signal: Pick<BacktestSignal, 'atr'>,
  prices: Candle[],
  signalIndex: number
): AtrBarrierObservation | null {
  const trade = getFixedHoldTrade(prices, signalIndex, 5, 0);
  if (!trade) return null;
  const levels = calculateLongRiskLevels(trade.entryPrice, signal.atr);
  if (!levels) return null;
  const sessions = prices.slice(trade.entryIdx, trade.exitIdx + 1);
  if (
    sessions.some(
      (bar) =>
        ![bar.open, bar.high, bar.low, bar.close].every(
          (price) => Number.isFinite(price) && price > 0
        ) ||
        bar.high < Math.max(bar.open, bar.close) ||
        bar.low > Math.min(bar.open, bar.close)
    )
  ) {
    return null;
  }

  const observation: AtrBarrierObservation = {
    stopLoss: levels.stopLoss,
    takeProfit: levels.takeProfit,
    stopTouched: false,
    targetTouched: false,
    firstTouch: 'neither',
    firstTouchDate: null,
    firstTouchFill: null,
    openingGap: false,
  };
  for (const bar of sessions) {
    const stopHit = bar.low <= levels.stopLoss;
    const targetHit = bar.high >= levels.takeProfit;
    observation.stopTouched ||= stopHit;
    observation.targetTouched ||= targetHit;
    if (observation.firstTouch !== 'neither') continue;
    if (!stopHit && !targetHit) continue;
    observation.firstTouchDate = sessionDate(bar.date);
    if (bar.open <= levels.stopLoss) {
      observation.firstTouch = 'stop';
      observation.firstTouchFill = bar.open;
      observation.openingGap = bar.open < levels.stopLoss;
    } else if (bar.open >= levels.takeProfit) {
      observation.firstTouch = 'target';
      observation.firstTouchFill = bar.open;
      observation.openingGap = bar.open > levels.takeProfit;
    } else if (stopHit && targetHit) {
      observation.firstTouch = 'ambiguous';
    } else {
      observation.firstTouch = stopHit ? 'stop' : 'target';
      observation.firstTouchFill = stopHit ? levels.stopLoss : levels.takeProfit;
    }
  }
  return observation;
}

export function summarizeHistoricalOutcomes(
  ticker: string,
  prices: Candle[],
  signals: BacktestSignal[],
  evaluationWindow: EvaluationWindow = {},
  costPct: number = DEFAULT_ROUND_TRIP_COST_PCT
): HistoricalOutcomesReport {
  const buys = signals.filter((signal) => signal.ticker === ticker && signal.decision === 'BUY');
  const data = new Map([[ticker, prices]]);
  const fixedHold = measure5DayWinRate(buys, data, costPct, evaluationWindow);
  const observations: AtrBarrierObservation[] = [];
  const excluded = { incomplete: 0, invalidExecution: 0, invalidAtrOrCandles: 0 };
  let buySignals = 0;
  for (const signal of buys) {
    const index = prices.findIndex((bar) => bar.date.getTime() === signal.date.getTime());
    const entry = prices[index + 1];
    if (index < 0) {
      excluded.invalidExecution++;
      continue;
    }
    if (entry && evaluationWindow.start && entry.date < evaluationWindow.start) continue;
    if (entry && evaluationWindow.end && entry.date > evaluationWindow.end) continue;
    buySignals++;
    if (index + 5 >= prices.length) {
      excluded.incomplete++;
      continue;
    }
    if (!getFixedHoldTrade(prices, index, 5, costPct)) {
      excluded.invalidExecution++;
      continue;
    }
    const observation = observeAtrBarriers(signal, prices, index);
    if (observation) observations.push(observation);
    else excluded.invalidAtrOrCandles++;
  }

  const eligibleEntries = prices.slice(1, Math.max(1, prices.length - 4)).filter((bar) => {
    return (
      (!evaluationWindow.start || bar.date >= evaluationWindow.start) &&
      (!evaluationWindow.end || bar.date <= evaluationWindow.end)
    );
  });
  const samples = observations.length;
  const stopTouched = observations.filter((sample) => sample.stopTouched).length;
  const targetTouched = observations.filter((sample) => sample.targetTouched).length;
  return {
    period: {
      from: eligibleEntries[0] ? sessionDate(eligibleEntries[0].date) : null,
      to: eligibleEntries.at(-1)
        ? sessionDate(eligibleEntries[eligibleEntries.length - 1].date)
        : null,
    },
    method: {
      horizonSessions: 5,
      entry: 'next-session-open',
      fixedHoldExit: 'fifth-session-close',
      roundTripCostBps: costPct * 100,
      sampleUnit: 'completed BUY observations; overlap permitted',
      atrBasis: 'signal-session ATR with actual next-session open',
    },
    buySignals,
    excluded,
    fixedHold: {
      samples: fixedHold.totalSignals,
      wins: fixedHold.wins,
      winRatePct: fixedHold.totalSignals ? fixedHold.winRate5d : null,
      averageNetReturnPct: fixedHold.totalSignals ? fixedHold.avgReturn : null,
      rewardRisk: fixedHold.totalSignals && fixedHold.avgLoss > 0 ? fixedHold.rewardRisk : null,
    },
    atrBarriers: {
      samples,
      stopTouched,
      targetTouched,
      bothTouched: observations.filter((sample) => sample.stopTouched && sample.targetTouched)
        .length,
      stopTouchRatePct: samples ? (stopTouched / samples) * 100 : null,
      targetTouchRatePct: samples ? (targetTouched / samples) * 100 : null,
      stopFirst: observations.filter((sample) => sample.firstTouch === 'stop').length,
      targetFirst: observations.filter((sample) => sample.firstTouch === 'target').length,
      ambiguousFirstTouch: observations.filter((sample) => sample.firstTouch === 'ambiguous')
        .length,
      neitherTouched: observations.filter((sample) => sample.firstTouch === 'neither').length,
      gapStopFirst: observations.filter(
        (sample) => sample.firstTouch === 'stop' && sample.openingGap
      ).length,
      gapTargetFirst: observations.filter(
        (sample) => sample.firstTouch === 'target' && sample.openingGap
      ).length,
    },
  };
}
