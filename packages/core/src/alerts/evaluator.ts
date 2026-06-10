import type { AlertRule, AlertTrigger, AlertTriggerState } from '@/alerts/types';
import type { TickerResult } from '@/types';

/**
 * Pure rule evaluation against a screener result. Environment-agnostic so a
 * future server-side cron + Web Push pipeline can reuse it unchanged.
 */
export function evaluateRule(rule: AlertRule, result: TickerResult): boolean {
  switch (rule.type) {
    case 'decision':
      return rule.params.decision != null && result.opinion === rule.params.decision;
    case 'gaussian-regime':
      if (rule.params.regime === 'green') return result.trendRegime === 'uptrend';
      if (rule.params.regime === 'red') return result.trendRegime === 'downtrend';
      return false;
    case 'price-below-sma50':
      return result.sma50 != null && result.close < result.sma50;
    default:
      return false;
  }
}

export function describeTrigger(rule: AlertRule, result: TickerResult): string {
  switch (rule.type) {
    case 'decision':
      return `${rule.ticker} decision → ${rule.params.decision} (close ${result.close.toFixed(2)})`;
    case 'gaussian-regime':
      return `${rule.ticker} Gaussian Channel → ${rule.params.regime === 'green' ? 'GREEN (uptrend)' : 'RED (downtrend)'}`;
    case 'price-below-sma50':
      return `${rule.ticker} pulled back below SMA50 (close ${result.close.toFixed(2)} < ${result.sma50?.toFixed(2)})`;
    default:
      return `${rule.ticker} alert`;
  }
}

/**
 * Detect false→true transitions for enabled rules. The first-ever evaluation
 * of a rule seeds the baseline without firing (prevents a notification storm
 * when adding a rule whose condition is already true).
 */
export function detectTransitions(
  rules: AlertRule[],
  results: TickerResult[],
  prevState: AlertTriggerState,
  now: Date = new Date()
): { triggers: AlertTrigger[]; nextState: AlertTriggerState } {
  const resultByTicker = new Map(results.map((r) => [r.ticker, r]));
  const triggers: AlertTrigger[] = [];
  const nextState: AlertTriggerState = { ...prevState };
  const nowIso = now.toISOString();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const result = resultByTicker.get(rule.ticker);
    if (!result) continue;

    const value = evaluateRule(rule, result);
    const prev = prevState[rule.id];

    if (prev !== undefined && !prev.lastValue && value) {
      triggers.push({
        rule,
        message: describeTrigger(rule, result),
        triggeredAt: nowIso,
      });
    }

    nextState[rule.id] = { lastValue: value, lastCheckedAt: nowIso };
  }

  return { triggers, nextState };
}
