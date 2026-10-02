'use client';

import { detectTransitions } from '@stock-checker/core/src/alerts/evaluator';
import { useEffect } from 'react';
import { notify } from '@/features/alerts/utils/notify';
import { loadRules, loadState, saveRules, saveState } from '@/features/alerts/utils/storage';
import { getScreener } from '@/lib/api';

/**
 * Background alert evaluation loop, mounted once in the root layout. Renders
 * nothing. Polls the screener for the union of rule tickers every 5 minutes
 * (upstream data is daily candles — faster polling adds load, not signal) and
 * fires notifications on rule transitions. Runs only while the app/PWA is open;
 * there is no push backend yet.
 */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

async function evaluateOnce(isActive: () => boolean): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const rules = loadRules();
  const enabled = rules.filter((r) => r.enabled);
  if (enabled.length === 0) return;

  const tickers = [...new Set(enabled.map((r) => r.ticker))];
  let results: Awaited<ReturnType<typeof getScreener>>;
  try {
    results = await getScreener(tickers);
  } catch {
    return; // transient network/API failure — next tick retries
  }

  if (!isActive()) return;

  // A rule may have been disabled or removed while the request was pending.
  const currentEnabled = loadRules().filter((r) => r.enabled);
  const { triggers, nextState } = detectTransitions(currentEnabled, results, loadState());
  saveState(nextState);

  if (triggers.length === 0) return;

  const triggeredIds = new Map<string, string>();
  for (const trigger of triggers) {
    if (!isActive()) return;
    if (!loadRules().some((r) => r.id === trigger.rule.id && r.enabled)) continue;

    await notify({
      title: `ALERT: ${trigger.rule.ticker}`,
      body: trigger.message,
      tag: trigger.rule.id,
      url: `/${trigger.rule.ticker}`,
    });
    triggeredIds.set(trigger.rule.id, trigger.triggeredAt);
  }

  if (!isActive() || triggeredIds.size === 0) return;

  saveRules(
    loadRules().map((r) =>
      triggeredIds.has(r.id) ? { ...r, lastTriggeredAt: triggeredIds.get(r.id) } : r
    )
  );
}

export function AlertEngine() {
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    async function poll() {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await evaluateOnce(() => !cancelled);
      } finally {
        inFlight = false;
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return null;
}
