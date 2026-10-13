import {
  isSession,
  latestCompletedSession,
  NYSE_EARLY_CLOSES,
  nextSessionOpen,
  sessionCloseAt,
  sessionOpenAt,
  sessionsAfter,
} from '@/utils/us-market-calendar';

/** The validated rule: enter at the next open, exit at the fifth session close. */
export const POSITION_HOLD_SESSIONS = 5;
export const SYDNEY_TIMEZONE = 'Australia/Sydney';
export const DEFAULT_MAX_POSITIONS = 5;
const MAX_POSITIONS_LIMIT = 20;

/**
 * Frozen in-sample result of the validated leader-pullback rule (155 non-overlapping
 * trades, 10 bps round trip). Shown once per digest as context, never as a forecast.
 */
export const VALIDATED_EXPECTATION = Object.freeze({
  samples: 155,
  winRatePct: 57.4,
  meanNetReturnPct: 0.63,
  worstNetReturnPct: -13.6,
  costBpsRoundTrip: 10,
  scope: 'in-sample' as const,
});

export interface PositionPlan {
  status: 'planned' | 'unavailable';
  /** User-facing explanation when the plan cannot be scheduled. */
  reason: string | null;
  signalSession: string;
  sessions: string[];
  entrySession: string | null;
  exitSession: string | null;
  /** UTC instants of the entry open and the (early-close aware) exit close. */
  entryOpenAt: string | null;
  exitCloseAt: string | null;
  exitEarlyClose: boolean;
}

export type PositionStage =
  | 'scheduled'
  | 'entry'
  | 'holding'
  | 'exit-eve'
  | 'exit-passed'
  | 'unplanned';

export interface PositionTiming {
  stage: PositionStage;
  /** Completed holding sessions so far (0 before the entry session closes, at most 5). */
  dayCount: number;
  nextOpenSession: string | null;
  latestCompletedSession: string | null;
}

export interface PositionSizing {
  capital: number | null;
  maxPositions: number;
  weightPct: number;
  perPosition: number | null;
  /** Environment variables that were ignored because their value was invalid. */
  invalid: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function buildPositionPlan(signalSession: string): PositionPlan {
  const base = {
    signalSession,
    sessions: [] as string[],
    entrySession: null,
    exitSession: null,
    entryOpenAt: null,
    exitCloseAt: null,
    exitEarlyClose: false,
  };
  if (!ISO_DATE.test(signalSession) || !isSession(signalSession)) {
    return {
      ...base,
      status: 'unavailable',
      reason: '신호 종가일이 검증된 NYSE 거래일(2026–2028)이 아닙니다.',
    };
  }
  const sessions = sessionsAfter(signalSession, POSITION_HOLD_SESSIONS);
  if (!sessions) {
    return {
      ...base,
      status: 'unavailable',
      reason: '보유 기간이 검증된 NYSE 달력(2026–2028) 밖입니다.',
    };
  }
  const exitSession = sessions[POSITION_HOLD_SESSIONS - 1];
  return {
    status: 'planned',
    reason: null,
    signalSession,
    sessions,
    entrySession: sessions[0],
    exitSession,
    entryOpenAt: new Date(sessionOpenAt(sessions[0])).toISOString(),
    exitCloseAt: new Date(sessionCloseAt(exitSession)).toISOString(),
    exitEarlyClose: NYSE_EARLY_CLOSES.has(exitSession),
  };
}

/** Where the position stands at `now`, from the shared calendar only (fills are not inferred). */
export function positionTiming(plan: PositionPlan, now: Date): PositionTiming {
  const instant = now.getTime();
  const nextOpen = nextSessionOpen(instant);
  const latest = latestCompletedSession(instant);
  const dayCount =
    latest === null ? 0 : Math.min(plan.sessions.filter((date) => date <= latest).length, 5);
  const timing = { dayCount, nextOpenSession: nextOpen, latestCompletedSession: latest };
  if (
    plan.status !== 'planned' ||
    !plan.entrySession ||
    !plan.exitSession ||
    !plan.entryOpenAt ||
    !plan.exitCloseAt
  ) {
    return { ...timing, stage: 'unplanned' };
  }
  if (instant >= Date.parse(plan.exitCloseAt)) return { ...timing, stage: 'exit-passed' };
  if (nextOpen === plan.entrySession) return { ...timing, stage: 'entry' };
  if (nextOpen === plan.exitSession) return { ...timing, stage: 'exit-eve' };
  if (instant >= Date.parse(plan.entryOpenAt)) return { ...timing, stage: 'holding' };
  return { ...timing, stage: 'scheduled' };
}

function positiveNumber(raw: string | undefined): number | null | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw.replace(/[,_]/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** `POSITIONS_CAPITAL` (optional) and `POSITIONS_MAX_POSITIONS` (default 5) drive the per-BUY weight. */
export function resolvePositionSizing(environment: NodeJS.ProcessEnv): PositionSizing {
  const invalid: string[] = [];
  let capital: number | null = null;
  const requestedCapital = positiveNumber(environment.POSITIONS_CAPITAL);
  if (requestedCapital === null) invalid.push('POSITIONS_CAPITAL');
  else if (requestedCapital !== undefined) capital = requestedCapital;
  let maxPositions = DEFAULT_MAX_POSITIONS;
  const requestedMax = positiveNumber(environment.POSITIONS_MAX_POSITIONS);
  if (
    requestedMax === null ||
    (requestedMax !== undefined &&
      (!Number.isInteger(requestedMax) || requestedMax > MAX_POSITIONS_LIMIT))
  ) {
    invalid.push('POSITIONS_MAX_POSITIONS');
  } else if (requestedMax !== undefined) maxPositions = requestedMax;
  const weightPct = 100 / maxPositions;
  return {
    capital,
    maxPositions,
    weightPct,
    perPosition: capital === null ? null : capital / maxPositions,
    invalid,
  };
}
