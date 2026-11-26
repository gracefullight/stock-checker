import { DEFAULT_ROUND_TRIP_COST_PCT } from '@/constants';
import { sessionCloseAt, sessionsAfter } from '@/utils/us-market-calendar';

/**
 * Shadow exits observed beside the frozen five-session paper policy.
 *
 * Every rule shares the paper entry (open of the first session after the signal),
 * the same round-trip cost, and SPY over its own entry-open to exit window. The
 * rule set is fixed here before any forward observation exists; changing a rule
 * means a new policy id, never an edit in place. Nothing in this module alters a
 * recommendation, the primary ledger row, or the shipped exit.
 */
export const MARKET_SCREEN_EXIT_STUDY_RULES = [
  'fixed-5',
  'fixed-10',
  'fixed-20',
  'prior-high-10',
] as const;

export type MarketScreenExitStudyRuleId = (typeof MARKET_SCREEN_EXIT_STUDY_RULES)[number];

export const MARKET_SCREEN_EXIT_STUDY_POLICY = Object.freeze({
  id: 'us-buy-exit-study-v1',
  mode: 'forward-paper-shadow',
  entry: 'next-session-open',
  benchmark: 'spy-same-entry-open-to-exit',
  costBpsRoundTrip: 10,
  /** The live exit, recomputed on the study series so every rule is compared on one fetch. */
  baseline: 'fixed-5',
  rules: Object.freeze({
    'fixed-5': 'Close of the fifth session.',
    'fixed-10': 'Close of the tenth session.',
    'fixed-20': 'Close of the twentieth session.',
    'prior-high-10':
      'Open after the first close above the previous session high; otherwise the close of the tenth session.',
  } satisfies Record<MarketScreenExitStudyRuleId, string>),
} as const);

const MAX_SESSIONS = 20;
/** An outcome that stayed unavailable is retried after this long even when no new session closed. */
const RETRY_MS = 6 * 60 * 60_000;
const CALENDAR_REASON = 'The holding window is outside the verified NYSE calendar (2026–2028).';
const MISSING_REASON =
  'Required completed benchmark or ticker sessions are missing; the exit was not shifted.';
const INFINITE_REASON = 'The paper return cannot be represented as a finite number.';
/** Recorded when the provider failed before any bar could be checked. */
export const MARKET_SCREEN_EXIT_STUDY_FETCH_REASON =
  'Market data could not verify the study window; explicitly refresh to retry.';

export interface MarketScreenExitStudyBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MarketScreenExitStudyOutcome {
  rule: MarketScreenExitStudyRuleId;
  status: 'open' | 'completed' | 'unavailable';
  reason: string | null;
  exitDate: string | null;
  /** Which price of the exit session closed the position. */
  exitAt: 'open' | 'close' | null;
  /** Sessions held from the entry open to the exit. */
  heldSessions: number | null;
  netReturnPct: number | null;
  spyNetReturnPct: number | null;
  excessReturnPct: number | null;
}

export interface MarketScreenExitStudyRecord {
  schemaVersion: 1;
  policyId: typeof MARKET_SCREEN_EXIT_STUDY_POLICY.id;
  recommendationId: string;
  ticker: string;
  dataAsOf: string;
  entryDate: string;
  /** Latest study session whose close had passed when this record was written. */
  observedThrough: string | null;
  updatedAt: string;
  outcomes: MarketScreenExitStudyOutcome[];
}

export interface MarketScreenExitStudyRuleSummary {
  rule: MarketScreenExitStudyRuleId;
  completed: number;
  open: number;
  unavailable: number;
  wins: number;
  winRatePct: number | null;
  averageHeldSessions: number | null;
  averageNetReturnPct: number | null;
  averageSpyNetReturnPct: number | null;
  averageExcessReturnPct: number | null;
  /** Recommendations completed under both this rule and the baseline. */
  pairedWithBaseline: number;
  /** Mean of (rule excess − baseline excess) over those pairs; null without a pair. */
  averageExcessVsBaselinePct: number | null;
}

type Bars = ReadonlyMap<string, MarketScreenExitStudyBar>;

const blank = (
  rule: MarketScreenExitStudyRuleId,
  status: MarketScreenExitStudyOutcome['status'],
  reason: string | null = null
): MarketScreenExitStudyOutcome => ({
  rule,
  status,
  reason,
  exitDate: null,
  exitAt: null,
  heldSessions: null,
  netReturnPct: null,
  spyNetReturnPct: null,
  excessReturnPct: null,
});

/** The signal session followed by as many study sessions as the verified calendar holds. */
export function marketScreenExitStudySessions(dataAsOf: string): string[] {
  for (const count of [MAX_SESSIONS, 10, 5]) {
    const sessions = sessionsAfter(dataAsOf, count);
    if (sessions) return [dataAsOf, ...sessions];
  }
  return [dataAsOf];
}

function latestClosed(sessions: string[], instant: number): string | null {
  let latest: string | null = null;
  for (const date of sessions) {
    if (sessionCloseAt(date) > instant) break;
    latest = date;
  }
  return latest;
}

const netReturn = (exit: number, entry: number): number => {
  const value = (exit / entry - 1) * 100 - DEFAULT_ROUND_TRIP_COST_PCT;
  return Math.abs(value) < 1e-9 ? 0 : value;
};

/**
 * Pure evaluation on completed bars keyed by session date. A completed outcome
 * in `previous` is returned untouched, so a later fetch on a re-adjusted series
 * never rewrites it. Missing sessions make a rule unavailable; no exit moves to
 * another bar.
 */
export function evaluateMarketScreenExitStudy(input: {
  dataAsOf: string;
  bars: Bars;
  spy: Bars;
  instant: number;
  previous?: readonly MarketScreenExitStudyOutcome[] | null;
}): { observedThrough: string | null; outcomes: MarketScreenExitStudyOutcome[] } {
  const { bars, spy, instant } = input;
  const sessions = marketScreenExitStudySessions(input.dataAsOf);
  const closed = (index: number) => sessionCloseAt(sessions[index]) <= instant;
  const priced = (index: number) => bars.has(sessions[index]) && spy.has(sessions[index]);

  const settle = (
    rule: MarketScreenExitStudyRuleId,
    exitIndex: number,
    exitAt: 'open' | 'close',
    heldSessions: number
  ): MarketScreenExitStudyOutcome => {
    const entry = bars.get(sessions[1]);
    const exit = bars.get(sessions[exitIndex]);
    const spyEntry = spy.get(sessions[1]);
    const spyExit = spy.get(sessions[exitIndex]);
    if (!entry || !exit || !spyEntry || !spyExit) return blank(rule, 'unavailable', MISSING_REASON);
    const netReturnPct = netReturn(exit[exitAt], entry.open);
    const spyNetReturnPct = netReturn(spyExit[exitAt], spyEntry.open);
    if (!Number.isFinite(netReturnPct) || !Number.isFinite(spyNetReturnPct))
      return blank(rule, 'unavailable', INFINITE_REASON);
    return {
      rule,
      status: 'completed',
      reason: null,
      exitDate: sessions[exitIndex],
      exitAt,
      heldSessions,
      netReturnPct,
      spyNetReturnPct,
      excessReturnPct: netReturnPct - spyNetReturnPct,
    };
  };

  const fixed = (rule: MarketScreenExitStudyRuleId, horizon: number) => {
    if (sessions.length <= horizon) return blank(rule, 'unavailable', CALENDAR_REASON);
    if (!closed(horizon)) return blank(rule, 'open');
    for (let index = 1; index <= horizon; index += 1)
      if (!priced(index)) return blank(rule, 'unavailable', MISSING_REASON);
    return settle(rule, horizon, 'close', horizon);
  };

  const priorHigh = (rule: MarketScreenExitStudyRuleId, horizon: number) => {
    if (sessions.length <= horizon) return blank(rule, 'unavailable', CALENDAR_REASON);
    for (let index = 1; index < horizon; index += 1) {
      if (!closed(index)) return blank(rule, 'open');
      const bar = bars.get(sessions[index]);
      const prior = bars.get(sessions[index - 1]);
      if (!bar || !prior || !spy.has(sessions[index]))
        return blank(rule, 'unavailable', MISSING_REASON);
      if (bar.close <= prior.high) continue;
      // The bounce is known at this close; the position leaves at the next open.
      if (!closed(index + 1)) return blank(rule, 'open');
      if (!priced(index + 1)) return blank(rule, 'unavailable', MISSING_REASON);
      return settle(rule, index + 1, 'open', index);
    }
    if (!closed(horizon)) return blank(rule, 'open');
    if (!priced(horizon)) return blank(rule, 'unavailable', MISSING_REASON);
    return settle(rule, horizon, 'close', horizon);
  };

  const evaluate: Record<MarketScreenExitStudyRuleId, () => MarketScreenExitStudyOutcome> = {
    'fixed-5': () => fixed('fixed-5', 5),
    'fixed-10': () => fixed('fixed-10', 10),
    'fixed-20': () => fixed('fixed-20', 20),
    'prior-high-10': () => priorHigh('prior-high-10', 10),
  };

  return {
    observedThrough: latestClosed(sessions, instant),
    outcomes: MARKET_SCREEN_EXIT_STUDY_RULES.map((rule) => {
      const frozen = input.previous?.find((outcome) => outcome.rule === rule);
      return frozen?.status === 'completed' ? { ...frozen } : evaluate[rule]();
    }),
  };
}

/**
 * True when a refresh can learn something new: no record yet, a study session
 * closed since the last write, or an unavailable outcome is old enough to retry.
 * Nothing is observable before the entry session closes.
 */
export function marketScreenExitStudyDue(
  record: MarketScreenExitStudyRecord | null,
  dataAsOf: string,
  instant: number
): boolean {
  const sessions = marketScreenExitStudySessions(dataAsOf);
  if (sessions.length < 2 || sessionCloseAt(sessions[1]) > instant) return false;
  if (!record) return true;
  const unsettled = record.outcomes.filter(
    (outcome) => outcome.status !== 'completed' && outcome.reason !== CALENDAR_REASON
  );
  if (!unsettled.length) return false;
  if (latestClosed(sessions, instant) !== record.observedThrough) return true;
  return (
    unsettled.some((outcome) => outcome.status === 'unavailable') &&
    instant - Date.parse(record.updatedAt) >= RETRY_MS
  );
}

/** The record to save when the provider failed: completed outcomes stay, the rest are unavailable. */
export function failedMarketScreenExitStudyOutcomes(
  previous: readonly MarketScreenExitStudyOutcome[] | null | undefined
): MarketScreenExitStudyOutcome[] {
  return MARKET_SCREEN_EXIT_STUDY_RULES.map((rule) => {
    const saved = previous?.find((outcome) => outcome.rule === rule);
    if (saved?.status === 'completed' || saved?.reason === CALENDAR_REASON) return { ...saved };
    return blank(rule, 'unavailable', MARKET_SCREEN_EXIT_STUDY_FETCH_REASON);
  });
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const sessionDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

function validOutcome(value: unknown, rule: MarketScreenExitStudyRuleId): boolean {
  const outcome = value as MarketScreenExitStudyOutcome | null;
  if (!outcome || typeof outcome !== 'object' || outcome.rule !== rule) return false;
  if (outcome.reason !== null && typeof outcome.reason !== 'string') return false;
  if (outcome.status === 'completed')
    return (
      sessionDate(outcome.exitDate) &&
      (outcome.exitAt === 'open' || outcome.exitAt === 'close') &&
      Number.isInteger(outcome.heldSessions) &&
      (outcome.heldSessions as number) >= 1 &&
      (outcome.heldSessions as number) <= MAX_SESSIONS &&
      finite(outcome.netReturnPct) &&
      finite(outcome.spyNetReturnPct) &&
      finite(outcome.excessReturnPct)
    );
  return (
    (outcome.status === 'open' || outcome.status === 'unavailable') &&
    outcome.exitDate === null &&
    outcome.exitAt === null &&
    outcome.heldSessions === null &&
    outcome.netReturnPct === null &&
    outcome.spyNetReturnPct === null &&
    outcome.excessReturnPct === null
  );
}

/**
 * A saved record that matches its recommendation and the current policy, or null.
 * The study is a shadow of the ledger, so a damaged file is recomputed on the next
 * refresh instead of making the primary paper performance unreadable.
 */
export function readMarketScreenExitStudyRecord(
  value: unknown,
  expected: { recommendationId: string; ticker: string; dataAsOf: string; entryDate: string }
): MarketScreenExitStudyRecord | null {
  const record = value as MarketScreenExitStudyRecord | null;
  if (
    !record ||
    typeof record !== 'object' ||
    record.schemaVersion !== 1 ||
    record.policyId !== MARKET_SCREEN_EXIT_STUDY_POLICY.id ||
    record.recommendationId !== expected.recommendationId ||
    record.ticker !== expected.ticker ||
    record.dataAsOf !== expected.dataAsOf ||
    record.entryDate !== expected.entryDate ||
    (record.observedThrough !== null && !sessionDate(record.observedThrough)) ||
    typeof record.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.updatedAt)) ||
    !Array.isArray(record.outcomes) ||
    record.outcomes.length !== MARKET_SCREEN_EXIT_STUDY_RULES.length ||
    !MARKET_SCREEN_EXIT_STUDY_RULES.every((rule, index) =>
      validOutcome(record.outcomes[index], rule)
    )
  )
    return null;
  return record;
}

/** Per-rule aggregates; every rule is listed, with null averages until it has a completed row. */
export function summarizeMarketScreenExitStudy(
  records: ReadonlyArray<MarketScreenExitStudyRecord | null>
): MarketScreenExitStudyRuleSummary[] {
  const baseline = MARKET_SCREEN_EXIT_STUDY_POLICY.baseline;
  return MARKET_SCREEN_EXIT_STUDY_RULES.map((rule) => {
    const summary: MarketScreenExitStudyRuleSummary = {
      rule,
      completed: 0,
      open: 0,
      unavailable: 0,
      wins: 0,
      winRatePct: null,
      averageHeldSessions: null,
      averageNetReturnPct: null,
      averageSpyNetReturnPct: null,
      averageExcessReturnPct: null,
      pairedWithBaseline: 0,
      averageExcessVsBaselinePct: null,
    };
    let held = 0;
    let net = 0;
    let spy = 0;
    let excess = 0;
    let paired = 0;
    for (const record of records) {
      const outcome = record?.outcomes.find((item) => item.rule === rule);
      if (!outcome) continue;
      summary[outcome.status] += 1;
      if (outcome.status !== 'completed') continue;
      if ((outcome.netReturnPct as number) > 0) summary.wins += 1;
      held += outcome.heldSessions as number;
      net += outcome.netReturnPct as number;
      spy += outcome.spyNetReturnPct as number;
      excess += outcome.excessReturnPct as number;
      const reference = record?.outcomes.find((item) => item.rule === baseline);
      if (reference?.status !== 'completed') continue;
      summary.pairedWithBaseline += 1;
      paired += (outcome.excessReturnPct as number) - (reference.excessReturnPct as number);
    }
    if (summary.completed) {
      summary.winRatePct = (summary.wins / summary.completed) * 100;
      summary.averageHeldSessions = held / summary.completed;
      summary.averageNetReturnPct = net / summary.completed;
      summary.averageSpyNetReturnPct = spy / summary.completed;
      summary.averageExcessReturnPct = excess / summary.completed;
    }
    if (summary.pairedWithBaseline)
      summary.averageExcessVsBaselinePct = paired / summary.pairedWithBaseline;
    return summary;
  });
}
