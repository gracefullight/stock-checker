import type { AlertRule, AlertTriggerState } from '@stock-checker/core/src/alerts/types';

// localStorage-backed rule store. This module is the single swap point for a
// future server-backed store (cron + Web Push) — the schema and evaluator
// already live in @stock-checker/core.
const RULES_KEY = 'stock-checker:alert-rules';
const STATE_KEY = 'stock-checker:alert-state';

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadRules(): AlertRule[] {
  if (typeof window === 'undefined') return [];
  return safeParse<AlertRule[]>(window.localStorage.getItem(RULES_KEY), []);
}

export function saveRules(rules: AlertRule[]): void {
  window.localStorage.setItem(RULES_KEY, JSON.stringify(rules));
}

export function loadState(): AlertTriggerState {
  if (typeof window === 'undefined') return {};
  return safeParse<AlertTriggerState>(window.localStorage.getItem(STATE_KEY), {});
}

export function saveState(state: AlertTriggerState): void {
  window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
}
