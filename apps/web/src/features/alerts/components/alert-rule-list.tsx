'use client';

import type { AlertRule } from '@stock-checker/core/src/alerts/types';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

interface AlertRuleListProps {
  rules: AlertRule[];
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
}

function describeRule(rule: AlertRule): string {
  switch (rule.type) {
    case 'decision':
      return `DECISION → ${rule.params.decision}`;
    case 'gaussian-regime':
      return `GC REGIME → ${rule.params.regime?.toUpperCase()}`;
    case 'price-below-sma50':
      return 'PRICE < SMA50';
    default:
      return rule.type;
  }
}

export function AlertRuleList({ rules, onToggle, onRemove }: AlertRuleListProps) {
  if (rules.length === 0) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        No alert rules yet. Add one above — it fires when the condition turns true.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/50" aria-label="Alert rules">
      {rules.map((rule) => (
        <li key={rule.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
          <Switch
            checked={rule.enabled}
            onCheckedChange={(checked) => onToggle(rule.id, checked)}
            aria-label={`${rule.enabled ? 'Disable' : 'Enable'} alert for ${rule.ticker}`}
          />
          <span className="font-mono text-xs font-bold text-foreground w-16">{rule.ticker}</span>
          <span className="font-mono text-xs text-muted-foreground flex-1">
            {describeRule(rule)}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground hidden sm:inline">
            {rule.lastTriggeredAt
              ? `LAST FIRED ${rule.lastTriggeredAt.slice(0, 16).replace('T', ' ')}`
              : 'NEVER FIRED'}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onRemove(rule.id)}
            aria-label={`Remove alert for ${rule.ticker}`}
            className="text-muted-foreground hover:text-destructive"
          >
            <X />
          </Button>
        </li>
      ))}
    </ul>
  );
}
