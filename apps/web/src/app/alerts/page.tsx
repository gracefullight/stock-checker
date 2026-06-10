'use client';

import type { AlertRule, AlertTriggerState } from '@stock-checker/core/src/alerts/types';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { AlertRuleForm } from '@/features/alerts/components/alert-rule-form';
import { AlertRuleList } from '@/features/alerts/components/alert-rule-list';
import { NotificationPermissionCard } from '@/features/alerts/components/notification-permission-card';
import { loadRules, loadState, saveRules, saveState } from '@/features/alerts/utils/storage';

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setRules(loadRules());
    setHydrated(true);
  }, []);

  function update(next: AlertRule[]) {
    setRules(next);
    saveRules(next);
  }

  function handleAdd(rule: AlertRule) {
    update([...rules, rule]);
  }

  function handleToggle(id: string, enabled: boolean) {
    update(rules.map((r) => (r.id === id ? { ...r, enabled } : r)));
  }

  function handleRemove(id: string) {
    update(rules.filter((r) => r.id !== id));
    const state: AlertTriggerState = loadState();
    if (state[id]) {
      delete state[id];
      saveState(state);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-sm font-bold font-mono tracking-widest text-primary">
          CONDITION ALERTS — {rules.filter((r) => r.enabled).length} ACTIVE
        </h1>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="border-b border-border py-1.5 px-3">
            <span className="text-[10px] font-mono text-muted-foreground">NOTIFICATIONS</span>
          </CardHeader>
          <CardContent className="pt-3">
            <NotificationPermissionCard />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border py-1.5 px-3">
            <span className="text-[10px] font-mono text-muted-foreground">ADD RULE</span>
          </CardHeader>
          <CardContent className="pt-3">
            <AlertRuleForm onAdd={handleAdd} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border py-1.5 px-3">
            <span className="text-[10px] font-mono text-muted-foreground">RULES</span>
          </CardHeader>
          <CardContent className="pt-3">
            {hydrated ? (
              <AlertRuleList rules={rules} onToggle={handleToggle} onRemove={handleRemove} />
            ) : (
              <p className="font-mono text-xs text-muted-foreground" aria-live="polite">
                LOADING...
              </p>
            )}
          </CardContent>
        </Card>

        <p className="font-mono text-[10px] text-muted-foreground">
          Rules are evaluated every 5 minutes while the app or installed PWA is open. There is no
          push backend yet — a closed app fires nothing.
        </p>
      </div>
    </div>
  );
}
