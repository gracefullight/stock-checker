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

async function evaluateOnce(): Promise<void> {
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

  const { triggers, nextState } = detectTransitions(enabled, results, loadState());
  saveState(nextState);

  if (triggers.length === 0) return;

  for (const trigger of triggers) {
    await notify({
      title: `ALERT: ${trigger.rule.ticker}`,
      body: trigger.message,
      tag: trigger.rule.id,
      url: `/${trigger.rule.ticker}`,
    });
  }

  const triggeredIds = new Map(triggers.map((t) => [t.rule.id, t.triggeredAt]));
  saveRules(
    rules.map((r) =>
      triggeredIds.has(r.id) ? { ...r, lastTriggeredAt: triggeredIds.get(r.id) } : r
    )
  );
}

export function AlertEngine() {
  useEffect(() => {
    void evaluateOnce();
    const interval = setInterval(() => void evaluateOnce(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return null;
}
