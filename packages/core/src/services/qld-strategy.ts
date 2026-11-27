/**
 * QLD volatility weight (`qld-vol-target-v1`).
 *
 * A research rule for the 2x Nasdaq-100 fund, measured in
 * docs/validation/qld-strategy-2026-11-27.md. It holds more QLD when QQQ is
 * calm and less when it is turbulent, so the account's volatility stays near
 * 20% a year. Signals use QQQ closes only:
 *
 *   - target = min(100%, 20% / (2 x 20-session annualised volatility))
 *   - the held weight moves only when the target is 10 points or more away
 *
 * A weight decided on a close is meant to be traded at the next open; the
 * rest of the account is cash. There is no trend filter: the rule stays
 * partly invested through a bear market.
 *
 * Each point also carries the averaging-down variant from the same document:
 * the volatility weight, but never below 50 / 75 / 100% once QQQ has fallen
 * 20 / 30 / 40% from its 252-session high, until it closes at a new high. That
 * variant earned more from 2013 and had a 69% drawdown through 2008; it is
 * shown for comparison and is not the adopted rule.
 */
export const QLD_STRATEGY_ID = 'qld-vol-target-v1';

/** Sessions held in cash before the first decision, as in the measurement. */
const WARMUP_SESSIONS = 200;
const VOLATILITY_SESSIONS = 20;
const TARGET_VOLATILITY = 0.2;
const FUND_LEVERAGE = 2;
const REBALANCE_BAND = 0.1;
const SESSIONS_PER_YEAR = 252;
const HIGH_SESSIONS = 252;
/** Minimum weight of the averaging-down variant at ladder levels 0..4. */
const AVERAGING_DOWN_FLOOR = [0, 0, 0.5, 0.75, 1] as const;

export interface QldStrategyBar {
  /** Session date, YYYY-MM-DD. */
  date: string;
  /** Adjusted QQQ close. */
  close: number;
}

export interface QldStrategyPoint {
  date: string;
  close: number;
  /** Annualised volatility of the last 20 daily returns (population). */
  volatility20: number;
  /** Weight the volatility target asks for, 0..1. */
  target: number;
  /** Weight to hold from the next open, 0..1. */
  weight: number;
  /** QQQ close against its highest close of the last 252 sessions, 0..1. */
  fallFromHigh: number;
  /** Deepest of the -10/-20/-30/-40% steps reached since the last 252-session high. */
  ladderLevel: 0 | 1 | 2 | 3 | 4;
  /** Weight of the averaging-down variant, 0..1. */
  averagingDownWeight: number;
}

/** The held weight after one close: small moves of the target are ignored. */
export function nextQldWeight(input: { target: number; held: number }): number {
  if (input.target === 0 || Math.abs(input.target - input.held) >= REBALANCE_BAND)
    return input.target;
  return input.held;
}

/**
 * Replays the rule over a chronological QQQ series. The band makes the weight
 * depend on its own past, so the replay must start from the same first bar to
 * give the same answer; the first 200 sessions hold cash.
 */
export function replayQldStrategy(bars: readonly QldStrategyBar[]): QldStrategyPoint[] {
  const points: QldStrategyPoint[] = [];
  let held = 0;
  let heldAveragingDown = 0;
  let level: QldStrategyPoint['ladderLevel'] = 0;
  for (let i = 0; i < bars.length; i++) {
    let high = 0;
    for (let k = Math.max(0, i - HIGH_SESSIONS + 1); k <= i; k++)
      high = Math.max(high, bars[k].close);
    const fallFromHigh = 1 - bars[i].close / high;
    const step =
      fallFromHigh >= 0.4
        ? 4
        : fallFromHigh >= 0.3
          ? 3
          : fallFromHigh >= 0.2
            ? 2
            : fallFromHigh >= 0.1
              ? 1
              : 0;
    level = bars[i].close >= high ? 0 : step > level ? step : level;
    if (i < WARMUP_SESSIONS) continue;
    let total = 0;
    let squares = 0;
    for (let k = i - VOLATILITY_SESSIONS + 1; k <= i; k++) {
      const change = bars[k].close / bars[k - 1].close - 1;
      total += change;
      squares += change * change;
    }
    const mean = total / VOLATILITY_SESSIONS;
    const volatility20 = Math.sqrt(
      Math.max(squares / VOLATILITY_SESSIONS - mean * mean, 0) * SESSIONS_PER_YEAR
    );
    const target =
      volatility20 > 0 ? Math.min(1, TARGET_VOLATILITY / (FUND_LEVERAGE * volatility20)) : 0;
    held = nextQldWeight({ target, held });
    heldAveragingDown = nextQldWeight({
      target: Math.max(target, AVERAGING_DOWN_FLOOR[level]),
      held: heldAveragingDown,
    });
    points.push({
      date: bars[i].date,
      close: bars[i].close,
      volatility20,
      target,
      weight: held,
      fallFromHigh,
      ladderLevel: level,
      averagingDownWeight: heldAveragingDown,
    });
  }
  return points;
}
