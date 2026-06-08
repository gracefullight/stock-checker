'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PatternList } from '@/components/pattern-list';
import { ScoreBar } from '@/components/score-bar';
import { SignalBadge } from '@/components/signal-badge';
import type { TickerResult } from '@/lib/api';

type SortKey = 'ticker' | 'close' | 'rsi' | 'score' | 'opinion';
type SortDir = 'asc' | 'desc';

interface ScreenerTableProps {
  results: TickerResult[];
}

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'ticker', label: 'TICKER' },
  { key: 'close', label: 'CLOSE' },
  { key: 'rsi', label: 'RSI' },
  { key: 'score', label: 'SCORE' },
  { key: 'opinion', label: 'SIGNAL' },
];

function rowBorderColor(opinion: string): string {
  if (opinion === 'BUY') return 'border-l-2 border-l-[var(--green)]';
  if (opinion === 'SELL') return 'border-l-2 border-l-[var(--red)]';
  return 'border-l-2 border-l-transparent';
}

export function ScreenerTable({ results }: ScreenerTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sorted = [...results].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    if (typeof av === 'number' && typeof bv === 'number') {
      return sortDir === 'asc' ? av - bv : bv - av;
    }
    return 0;
  });

  function sortIndicator(key: SortKey): string {
    if (key !== sortKey) return '';
    return sortDir === 'asc' ? ' ^' : ' v';
  }

  return (
    <div className="overflow-x-auto">
      <table
        className="w-full text-xs font-mono border-collapse"
        aria-label="Stock screener results"
      >
        <thead>
          <tr className="border-b border-[var(--border)]">
            {COLUMNS.map(({ key, label }) => (
              <th
                key={key}
                className="py-2 px-3 text-left text-[var(--text-secondary)] font-normal cursor-pointer select-none hover:text-[var(--text-primary)] whitespace-nowrap"
                onClick={() => handleSort(key)}
                aria-sort={
                  sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                }
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handleSort(key);
                }}
              >
                {label}
                <span aria-hidden="true">{sortIndicator(key)}</span>
              </th>
            ))}
            <th className="py-2 px-3 text-left text-[var(--text-secondary)] font-normal whitespace-nowrap">
              PATTERNS
            </th>
            <th className="py-2 px-3 text-left text-[var(--text-secondary)] font-normal whitespace-nowrap">
              ACTION
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.ticker}
              className={`border-b border-[var(--border)] hover:bg-[var(--surface)] ${rowBorderColor(row.opinion)}`}
            >
              <td className="py-1.5 px-3 font-bold text-[var(--text-primary)]">
                <Link
                  href={`/${row.ticker}`}
                  className="hover:text-[var(--cyan)] transition-colors"
                >
                  {row.ticker}
                </Link>
              </td>
              <td className="py-1.5 px-3 tabular-nums text-right text-[var(--text-primary)]">
                {row.close.toFixed(2)}
              </td>
              <td className="py-1.5 px-3 tabular-nums text-right">
                <span
                  className={
                    row.rsi >= 70
                      ? 'text-[var(--red)]'
                      : row.rsi <= 30
                        ? 'text-[var(--green)]'
                        : 'text-[var(--text-primary)]'
                  }
                >
                  {row.rsi.toFixed(1)}
                </span>
              </td>
              <td className="py-1.5 px-3">
                <ScoreBar value={row.score} />
              </td>
              <td className="py-1.5 px-3">
                <SignalBadge signal={row.opinion as 'BUY' | 'SELL' | 'HOLD'} />
              </td>
              <td className="py-1.5 px-3 max-w-[300px]">
                <PatternList patterns={row.patterns} />
              </td>
              <td className="py-1.5 px-3">
                <Link
                  href={`/${row.ticker}`}
                  className="text-[var(--cyan)] hover:underline text-xs"
                  aria-label={`View details for ${row.ticker}`}
                >
                  DETAIL
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
