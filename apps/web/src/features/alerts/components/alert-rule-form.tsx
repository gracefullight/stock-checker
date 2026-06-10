'use client';

import type { AlertConditionType, AlertRule } from '@stock-checker/core/src/alerts/types';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AlertRuleFormProps {
  onAdd: (rule: AlertRule) => void;
}

const CONDITION_LABELS: Record<AlertConditionType, string> = {
  decision: 'DECISION BECOMES',
  'gaussian-regime': 'GC REGIME FLIPS TO',
  'price-below-sma50': 'PRICE DROPS BELOW SMA50',
};

export function AlertRuleForm({ onAdd }: AlertRuleFormProps) {
  const [symbol, setSymbol] = useState('');
  const [type, setType] = useState<AlertConditionType>('decision');
  const [decision, setDecision] = useState<'BUY' | 'SELL'>('BUY');
  const [regime, setRegime] = useState<'green' | 'red'>('green');

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = symbol.trim().toUpperCase();
    if (!/^[A-Z][A-Z.]{0,5}$/.test(trimmed)) {
      toast.error('Invalid ticker symbol');
      return;
    }

    const rule: AlertRule = {
      id: crypto.randomUUID(),
      ticker: trimmed,
      type,
      params: type === 'decision' ? { decision } : type === 'gaussian-regime' ? { regime } : {},
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    onAdd(rule);
    setSymbol('');
    toast.success(`Alert rule added for ${trimmed}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 flex-wrap"
      aria-label="Add alert rule"
    >
      <label htmlFor="alert-ticker-input" className="sr-only">
        Ticker symbol
      </label>
      <Input
        id="alert-ticker-input"
        type="text"
        placeholder="TICKER"
        value={symbol}
        onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        className="w-28 font-mono text-xs uppercase"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
      />

      <Select value={type} onValueChange={(v) => setType(v as AlertConditionType)}>
        <SelectTrigger className="w-56 font-mono text-xs" aria-label="Alert condition">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(CONDITION_LABELS) as AlertConditionType[]).map((key) => (
            <SelectItem key={key} value={key} className="font-mono text-xs">
              {CONDITION_LABELS[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {type === 'decision' && (
        <Select value={decision} onValueChange={(v) => setDecision(v as 'BUY' | 'SELL')}>
          <SelectTrigger className="w-24 font-mono text-xs" aria-label="Decision value">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BUY" className="font-mono text-xs">
              BUY
            </SelectItem>
            <SelectItem value="SELL" className="font-mono text-xs">
              SELL
            </SelectItem>
          </SelectContent>
        </Select>
      )}

      {type === 'gaussian-regime' && (
        <Select value={regime} onValueChange={(v) => setRegime(v as 'green' | 'red')}>
          <SelectTrigger className="w-36 font-mono text-xs" aria-label="Regime value">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="green" className="font-mono text-xs">
              GREEN (UPTREND)
            </SelectItem>
            <SelectItem value="red" className="font-mono text-xs">
              RED (DOWNTREND)
            </SelectItem>
          </SelectContent>
        </Select>
      )}

      <Button type="submit" size="sm" disabled={!symbol.trim()} className="font-mono text-xs">
        ADD RULE
      </Button>
    </form>
  );
}
