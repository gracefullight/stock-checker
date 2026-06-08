'use client';

import { useEffect, useState } from 'react';
import type { FearGreedResult } from '@/lib/api';
import { getFearGreed } from '@/lib/api';

export function FearGreedDisplay() {
  const [data, setData] = useState<FearGreedResult | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getFearGreed()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error || !data) {
    return (
      <span className="text-xs font-mono text-[var(--text-secondary)]">
        {error ? 'F&G: N/A' : 'F&G: ...'}
      </span>
    );
  }

  let color = 'text-[var(--yellow)]';
  if (data.value >= 60) color = 'text-[var(--green)]';
  else if (data.value <= 30) color = 'text-[var(--red)]';

  return (
    <span
      className="text-xs font-mono"
      aria-label={`Fear & Greed Index: ${data.value} (${data.label})`}
    >
      <span className="text-[var(--text-secondary)]">F&G: </span>
      <span className={`font-bold ${color}`}>{data.value}</span>
      <span className="text-[var(--text-secondary)] ml-1">({data.label})</span>
    </span>
  );
}
