import { describe, expect, it } from 'vitest';
import { detectTransitions, evaluateRule } from '@/alerts/evaluator';
import type { AlertRule, AlertTriggerState } from '@/alerts/types';
import type { TickerResult } from '@/types';

function makeResult(overrides: Partial<TickerResult> = {}): TickerResult {
  return {
    ticker: 'NVDA',
    date: '2026-06-09',
    close: 100,
    volume: 1_000_000,
    rsi: 50,
    stochasticK: 50,
    bbLower: 90,
    bbUpper: 110,
    donchLower: 85,
    donchUpper: 115,
    williamsR: -50,
    fearGreed: 50,
    patterns: [],
    score: 100,
    opinion: 'HOLD',
    atr: 3,
    stopLoss: 95,
    takeProfit: 106,
    trailingStop: 95,
    trailingStart: 101.5,
    macd: 0,
    macdSignal: 0,
    macdHistogram: 0,
    sma20: 99,
    ema20: 99,
    ...overrides,
  };
}

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'rule-1',
    ticker: 'NVDA',
    type: 'decision',
    params: { decision: 'BUY' },
    enabled: true,
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('evaluateRule', () => {
  it('matches decision rules against opinion', () => {
    const rule = makeRule();
    expect(evaluateRule(rule, makeResult({ opinion: 'BUY' }))).toBe(true);
    expect(evaluateRule(rule, makeResult({ opinion: 'HOLD' }))).toBe(false);
  });

  it('matches gaussian regime rules against trendRegime', () => {
    const green = makeRule({ type: 'gaussian-regime', params: { regime: 'green' } });
    const red = makeRule({ type: 'gaussian-regime', params: { regime: 'red' } });
    expect(evaluateRule(green, makeResult({ trendRegime: 'uptrend' }))).toBe(true);
    expect(evaluateRule(green, makeResult({ trendRegime: 'downtrend' }))).toBe(false);
    expect(evaluateRule(red, makeResult({ trendRegime: 'downtrend' }))).toBe(true);
  });

  it('matches price-below-sma50 only when sma50 is known', () => {
    const rule = makeRule({ type: 'price-below-sma50', params: {} });
    expect(evaluateRule(rule, makeResult({ close: 95, sma50: 100 }))).toBe(true);
    expect(evaluateRule(rule, makeResult({ close: 105, sma50: 100 }))).toBe(false);
    expect(evaluateRule(rule, makeResult({ close: 95 }))).toBe(false);
  });
});

describe('detectTransitions', () => {
  const now = new Date('2026-06-09T12:00:00Z');

  it('seeds the baseline silently on first evaluation', () => {
    const rule = makeRule();
    const { triggers, nextState } = detectTransitions(
      [rule],
      [makeResult({ opinion: 'BUY' })],
      {},
      now
    );

    expect(triggers).toHaveLength(0);
    expect(nextState[rule.id]).toEqual({
      lastValue: true,
      lastCheckedAt: now.toISOString(),
    });
  });

  it('fires only on false→true transitions', () => {
    const rule = makeRule();
    const prevFalse: AlertTriggerState = {
      [rule.id]: { lastValue: false, lastCheckedAt: '2026-06-09T11:00:00Z' },
    };

    const fired = detectTransitions([rule], [makeResult({ opinion: 'BUY' })], prevFalse, now);
    expect(fired.triggers).toHaveLength(1);
    expect(fired.triggers[0].message).toContain('NVDA decision → BUY');

    // true→true: no re-fire
    const again = detectTransitions([rule], [makeResult({ opinion: 'BUY' })], fired.nextState, now);
    expect(again.triggers).toHaveLength(0);

    // true→false: state resets without firing
    const reset = detectTransitions(
      [rule],
      [makeResult({ opinion: 'HOLD' })],
      again.nextState,
      now
    );
    expect(reset.triggers).toHaveLength(0);
    expect(reset.nextState[rule.id].lastValue).toBe(false);
  });

  it('skips disabled rules and unknown tickers', () => {
    const disabled = makeRule({ id: 'r-disabled', enabled: false });
    const unknown = makeRule({ id: 'r-unknown', ticker: 'ZZZZ' });
    const prev: AlertTriggerState = {
      'r-disabled': { lastValue: false, lastCheckedAt: '2026-06-09T11:00:00Z' },
      'r-unknown': { lastValue: false, lastCheckedAt: '2026-06-09T11:00:00Z' },
    };

    const { triggers, nextState } = detectTransitions(
      [disabled, unknown],
      [makeResult({ opinion: 'BUY' })],
      prev,
      now
    );

    expect(triggers).toHaveLength(0);
    expect(nextState['r-disabled'].lastCheckedAt).toBe('2026-06-09T11:00:00Z');
    expect(nextState['r-unknown'].lastCheckedAt).toBe('2026-06-09T11:00:00Z');
  });
});
