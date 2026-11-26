import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUND_TRIP_COST_PCT } from '@/constants';
import {
  evaluateMarketScreenExitStudy,
  MARKET_SCREEN_EXIT_STUDY_POLICY,
  MARKET_SCREEN_EXIT_STUDY_RULES,
  type MarketScreenExitStudyBar,
  type MarketScreenExitStudyRecord,
  marketScreenExitStudyDue,
  marketScreenExitStudySessions,
  readMarketScreenExitStudyRecord,
  summarizeMarketScreenExitStudy,
} from '@/reports/market-screen-exit-study';
import { sessionCloseAt } from '@/utils/us-market-calendar';

const SIGNAL = '2026-09-25';
const SESSIONS = marketScreenExitStudySessions(SIGNAL);
const HOUR = 60 * 60_000;
const closeOf = (index: number) => sessionCloseAt(SESSIONS[index]);

function flat(dates = SESSIONS): Map<string, MarketScreenExitStudyBar> {
  return new Map(dates.map((date) => [date, { open: 100, high: 101, low: 99, close: 100 }]));
}

/** Closes above the prior high on session 3, then 103 / 99 / 110 at sessions 5 / 10 / 20. */
function shaped(): Map<string, MarketScreenExitStudyBar> {
  const close: Record<number, number> = { 3: 102, 5: 103, 10: 99, 20: 110 };
  const high: Record<number, number> = { 3: 103, 5: 104, 20: 111 };
  return new Map(
    SESSIONS.map((date, index) => [
      date,
      {
        open: index === 4 ? 101.5 : 100,
        high: high[index] ?? 101.5,
        low: 98,
        close: close[index] ?? 100,
      },
    ])
  );
}

function record(
  evaluated: ReturnType<typeof evaluateMarketScreenExitStudy>,
  updatedAt: number,
  index = 0
): MarketScreenExitStudyRecord {
  return {
    schemaVersion: 1,
    policyId: MARKET_SCREEN_EXIT_STUDY_POLICY.id,
    recommendationId: `job:${index}`,
    ticker: `T${index}`,
    dataAsOf: SIGNAL,
    entryDate: SESSIONS[1],
    observedThrough: evaluated.observedThrough,
    updatedAt: new Date(updatedAt).toISOString(),
    outcomes: evaluated.outcomes,
  };
}

describe('forward paper exit study', () => {
  it('charges the shared round-trip cost and describes every registered rule', () => {
    expect(MARKET_SCREEN_EXIT_STUDY_POLICY.costBpsRoundTrip).toBe(
      DEFAULT_ROUND_TRIP_COST_PCT * 100
    );
    expect(Object.keys(MARKET_SCREEN_EXIT_STUDY_POLICY.rules)).toEqual([
      ...MARKET_SCREEN_EXIT_STUDY_RULES,
    ]);
    expect(MARKET_SCREEN_EXIT_STUDY_RULES).toContain(MARKET_SCREEN_EXIT_STUDY_POLICY.baseline);
  });

  it('follows the signal session with twenty holiday-aware sessions', () => {
    expect(SESSIONS).toHaveLength(21);
    expect(SESSIONS[0]).toBe(SIGNAL);
    expect(SESSIONS[1]).toBe('2026-09-28');
    expect(SESSIONS[10]).toBe('2026-10-09');
    expect(SESSIONS[20]).toBe('2026-10-23');
  });

  it('settles fixed horizons at their close and the bounce at the next open', () => {
    const { observedThrough, outcomes } = evaluateMarketScreenExitStudy({
      dataAsOf: SIGNAL,
      bars: shaped(),
      spy: flat(),
      instant: closeOf(20),
    });
    expect(observedThrough).toBe(SESSIONS[20]);
    expect(outcomes.map((outcome) => outcome.rule)).toEqual([...MARKET_SCREEN_EXIT_STUDY_RULES]);
    const [five, ten, twenty, bounce] = outcomes;
    expect(five).toMatchObject({
      status: 'completed',
      exitDate: SESSIONS[5],
      exitAt: 'close',
      heldSessions: 5,
    });
    expect(five.netReturnPct).toBeCloseTo(2.9, 10);
    expect(five.spyNetReturnPct).toBeCloseTo(-0.1, 10);
    expect(five.excessReturnPct).toBeCloseTo(3, 10);
    expect(ten).toMatchObject({ status: 'completed', exitDate: SESSIONS[10], heldSessions: 10 });
    expect(ten.netReturnPct).toBeCloseTo(-1.1, 10);
    expect(twenty).toMatchObject({ status: 'completed', exitDate: SESSIONS[20], heldSessions: 20 });
    expect(twenty.netReturnPct).toBeCloseTo(9.9, 10);
    // Session 3 closes above session 2's high, so the position leaves at session 4's open.
    expect(bounce).toMatchObject({
      status: 'completed',
      exitDate: SESSIONS[4],
      exitAt: 'open',
      heldSessions: 3,
    });
    expect(bounce.netReturnPct).toBeCloseTo(1.4, 10);
    expect(bounce.excessReturnPct).toBeCloseTo(1.5, 10);
  });

  it('keeps unfinished windows open, including a bounce whose exit open is not complete', () => {
    const waiting = evaluateMarketScreenExitStudy({
      dataAsOf: SIGNAL,
      bars: shaped(),
      spy: flat(),
      instant: closeOf(3),
    });
    expect(waiting.outcomes.map((outcome) => outcome.status)).toEqual([
      'open',
      'open',
      'open',
      'open',
    ]);
    const later = evaluateMarketScreenExitStudy({
      dataAsOf: SIGNAL,
      bars: shaped(),
      spy: flat(),
      instant: closeOf(5),
    });
    expect(later.observedThrough).toBe(SESSIONS[5]);
    expect(later.outcomes.map((outcome) => outcome.status)).toEqual([
      'completed',
      'open',
      'open',
      'completed',
    ]);
  });

  it('marks a rule unavailable instead of moving its exit past a missing session', () => {
    const bars = shaped();
    bars.delete(SESSIONS[2]);
    const { outcomes } = evaluateMarketScreenExitStudy({
      dataAsOf: SIGNAL,
      bars,
      spy: flat(),
      instant: closeOf(5),
    });
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'unavailable',
      'open',
      'open',
      'unavailable',
    ]);
    expect(outcomes[0]).toMatchObject({ netReturnPct: null, exitDate: null });
    expect(outcomes[0].reason).toContain('not shifted');
  });

  it('never recalculates a completed outcome on a later series', () => {
    const first = evaluateMarketScreenExitStudy({
      dataAsOf: SIGNAL,
      bars: shaped(),
      spy: flat(),
      instant: closeOf(5),
    });
    const later = evaluateMarketScreenExitStudy({
      dataAsOf: SIGNAL,
      bars: new Map(),
      spy: new Map(),
      instant: closeOf(20),
      previous: first.outcomes,
    });
    expect(later.outcomes[0]).toEqual(first.outcomes[0]);
    expect(later.outcomes[3]).toEqual(first.outcomes[3]);
    expect(later.outcomes[1].status).toBe('unavailable');
    expect(later.outcomes[2].status).toBe('unavailable');
  });

  it('fails closed where the verified calendar ends', () => {
    const sessions = marketScreenExitStudySessions('2028-12-15');
    expect(sessions).toHaveLength(6);
    const evaluated = evaluateMarketScreenExitStudy({
      dataAsOf: '2028-12-15',
      bars: flat(sessions),
      spy: flat(sessions),
      instant: sessionCloseAt(sessions[5]),
    });
    expect(evaluated.outcomes.map((outcome) => outcome.status)).toEqual([
      'completed',
      'unavailable',
      'unavailable',
      'unavailable',
    ]);
    expect(evaluated.outcomes[1].reason).toContain('calendar');
    const saved = { ...record(evaluated, sessionCloseAt(sessions[5])), dataAsOf: '2028-12-15' };
    // Calendar-limited rules can never settle, so they never ask for another fetch.
    expect(
      marketScreenExitStudyDue(saved, '2028-12-15', sessionCloseAt(sessions[5]) + 720 * HOUR)
    ).toBe(false);
    expect(marketScreenExitStudySessions('2028-12-22')).toEqual(['2028-12-22']);
    expect(marketScreenExitStudyDue(null, '2028-12-22', Date.parse('2029-02-01T00:00:00Z'))).toBe(
      false
    );
  });

  it('asks for prices only when a session closed or an unavailable outcome is old enough', () => {
    expect(marketScreenExitStudyDue(null, SIGNAL, closeOf(1) - 1)).toBe(false);
    expect(marketScreenExitStudyDue(null, SIGNAL, closeOf(1))).toBe(true);
    const settled = record(
      evaluateMarketScreenExitStudy({
        dataAsOf: SIGNAL,
        bars: shaped(),
        spy: flat(),
        instant: closeOf(5),
      }),
      closeOf(5)
    );
    expect(marketScreenExitStudyDue(settled, SIGNAL, closeOf(5))).toBe(false);
    expect(marketScreenExitStudyDue(settled, SIGNAL, closeOf(6) - 1)).toBe(false);
    expect(marketScreenExitStudyDue(settled, SIGNAL, closeOf(6))).toBe(true);
    const bars = shaped();
    bars.delete(SESSIONS[2]);
    const gapped = record(
      evaluateMarketScreenExitStudy({ dataAsOf: SIGNAL, bars, spy: flat(), instant: closeOf(5) }),
      closeOf(5)
    );
    expect(marketScreenExitStudyDue(gapped, SIGNAL, closeOf(5) + 6 * HOUR - 1)).toBe(false);
    expect(marketScreenExitStudyDue(gapped, SIGNAL, closeOf(5) + 6 * HOUR)).toBe(true);
  });

  it('summarizes each rule and pairs it with the baseline on the same recommendation', () => {
    const full = record(
      evaluateMarketScreenExitStudy({
        dataAsOf: SIGNAL,
        bars: shaped(),
        spy: flat(),
        instant: closeOf(20),
      }),
      closeOf(20)
    );
    const early = record(
      evaluateMarketScreenExitStudy({
        dataAsOf: SIGNAL,
        bars: flat(),
        spy: flat(),
        instant: closeOf(5),
      }),
      closeOf(5),
      1
    );
    const summary = summarizeMarketScreenExitStudy([full, early, null]);
    expect(summary.map((rule) => rule.rule)).toEqual([...MARKET_SCREEN_EXIT_STUDY_RULES]);
    const [five, ten] = summary;
    expect(five).toMatchObject({ completed: 2, open: 0, wins: 1, pairedWithBaseline: 2 });
    expect(five.winRatePct).toBe(50);
    expect(five.averageNetReturnPct).toBeCloseTo(1.4, 10);
    expect(five.averageExcessVsBaselinePct).toBeCloseTo(0, 10);
    expect(ten).toMatchObject({ completed: 1, open: 1, wins: 0, pairedWithBaseline: 1 });
    expect(ten.averageHeldSessions).toBe(10);
    expect(ten.averageExcessReturnPct).toBeCloseTo(-1, 10);
    expect(ten.averageExcessVsBaselinePct).toBeCloseTo(-4, 10);
    expect(summarizeMarketScreenExitStudy([])[0]).toMatchObject({
      completed: 0,
      winRatePct: null,
      averageNetReturnPct: null,
      averageExcessVsBaselinePct: null,
    });
  });

  it('accepts only a saved record that matches its recommendation and the policy', () => {
    const saved = record(
      evaluateMarketScreenExitStudy({
        dataAsOf: SIGNAL,
        bars: shaped(),
        spy: flat(),
        instant: closeOf(20),
      }),
      closeOf(20)
    );
    const expected = {
      recommendationId: 'job:0',
      ticker: 'T0',
      dataAsOf: SIGNAL,
      entryDate: SESSIONS[1],
    };
    const copy = () => JSON.parse(JSON.stringify(saved)) as MarketScreenExitStudyRecord;
    expect(readMarketScreenExitStudyRecord(copy(), expected)).toEqual(saved);
    expect(readMarketScreenExitStudyRecord(copy(), { ...expected, ticker: 'ZZ' })).toBeNull();
    expect(readMarketScreenExitStudyRecord(null, expected)).toBeNull();
    expect(readMarketScreenExitStudyRecord({ ...copy(), policyId: 'other' }, expected)).toBeNull();
    const incomplete = copy();
    incomplete.outcomes[0].netReturnPct = null;
    expect(readMarketScreenExitStudyRecord(incomplete, expected)).toBeNull();
    const reordered = copy();
    reordered.outcomes.reverse();
    expect(readMarketScreenExitStudyRecord(reordered, expected)).toBeNull();
  });
});
