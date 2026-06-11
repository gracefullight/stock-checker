'use client';

import { useEffect, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type FxRateResult, getFxRate } from '@/lib/api';
import {
  FX_CURRENCIES,
  type FxCurrency,
  formatRate,
  setDisplayCurrency,
  useDisplayCurrency,
} from '@/lib/currency';

function changeColorClass(pct: number | null): string {
  if (pct === null) return 'text-muted-foreground';
  if (pct > 0) return 'text-success';
  if (pct < 0) return 'text-destructive';
  return 'text-muted-foreground';
}

/**
 * USD→selected-currency spot rate in the top status bar, with a currency
 * selector (default KRW, persisted in localStorage).
 */
export function FxDisplay() {
  const currency = useDisplayCurrency();
  const [fx, setFx] = useState<FxRateResult | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFx(null);
    setError(false);
    getFxRate(currency)
      .then((data) => {
        if (!cancelled) setFx(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [currency]);

  const arrow = fx?.dayChangePct == null ? '' : fx.dayChangePct >= 0 ? '▲' : '▼';

  return (
    <span className="flex items-center gap-1 text-xs font-mono">
      <span className="text-muted-foreground">USD/</span>
      <Select value={currency} onValueChange={(v) => setDisplayCurrency(v as FxCurrency)}>
        <SelectTrigger
          size="sm"
          className="h-6 gap-1 border-none bg-transparent px-1 font-mono text-xs shadow-none"
          aria-label="Display currency"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FX_CURRENCIES.map((c) => (
            <SelectItem key={c} value={c} className="font-mono text-xs">
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <span className="text-muted-foreground">N/A</span>
      ) : !fx ? (
        <span className="text-muted-foreground">...</span>
      ) : (
        <span
          className={changeColorClass(fx.dayChangePct)}
          aria-label={`1 US dollar is ${formatRate(fx.rate)} ${currency}${
            fx.dayChangePct != null ? `, ${fx.dayChangePct.toFixed(2)} percent today` : ''
          }`}
        >
          {formatRate(fx.rate)}
          {fx.dayChangePct != null && (
            <span className="ml-1">
              {arrow}
              {Math.abs(fx.dayChangePct).toFixed(2)}%
            </span>
          )}
        </span>
      )}
    </span>
  );
}
