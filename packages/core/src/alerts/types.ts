export type AlertConditionType = 'decision' | 'gaussian-regime' | 'price-below-sma50';

export interface AlertRuleParams {
  /** For 'decision': the opinion that triggers the alert. */
  decision?: 'BUY' | 'SELL';
  /** For 'gaussian-regime': green = uptrend, red = downtrend. */
  regime?: 'green' | 'red';
}

export interface AlertRule {
  id: string;
  ticker: string;
  type: AlertConditionType;
  params: AlertRuleParams;
  enabled: boolean;
  createdAt: string;
  lastTriggeredAt?: string;
}

/**
 * Per-rule evaluation state. `lastValue` missing means the rule has never been
 * evaluated — the first evaluation seeds a baseline silently instead of firing.
 */
export interface AlertTriggerState {
  [ruleId: string]: { lastValue: boolean; lastCheckedAt: string };
}

export interface AlertTrigger {
  rule: AlertRule;
  message: string;
  triggeredAt: string;
}
