'use client';

import { useEffect, useState } from 'react';
import { type FxRateResult, getFxRate } from '@/lib/api';
import { formatInCurrency, useDisplayCurrency } from '@/lib/currency';

/**
 * USD amount converted into the user's display currency (header selector,
 * default KRW). Renders nothing until the rate arrives — the USD price next
 * to it is always the source of truth.
 */
export function ConvertedPrice({ usd }: { usd: number }) {
  const currency = useDisplayCurrency();
  const [fx, setFx] = useState<FxRateResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFx(null);
    getFxRate(currency)
      .then((data) => {
        if (!cancelled) setFx(data);
      })
      .catch(() => {
        /* conversion is decorative — USD price remains visible */
      });
    return () => {
      cancelled = true;
    };
  }, [currency]);

  if (!fx) return null;

  return (
    <span
      className="text-sm font-mono tabular-nums text-muted-foreground"
      aria-label={`Approximately ${formatInCurrency(usd, fx.rate, currency)}`}
    >
      ≈ {formatInCurrency(usd, fx.rate, currency)}
    </span>
  );
}
