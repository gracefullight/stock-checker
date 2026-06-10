'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EarningsWarningBadge } from '@/components/common/earnings-warning-badge';
import { PatternList } from '@/components/pattern-list';
import { ScoreBar } from '@/components/score-bar';
import { SignalBadge } from '@/components/signal-badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
  if (opinion === 'BUY') return 'border-l-2 border-l-success';
  if (opinion === 'SELL') return 'border-l-2 border-l-destructive';
  return 'border-l-2 border-l-transparent';
}

function rsiColorClass(rsi: number): string {
  if (rsi >= 70) return 'text-destructive';
  if (rsi <= 30) return 'text-success';
  return 'text-foreground';
}

/** Ticker link that shows the company name in a tooltip on hover (when known). */
function TickerLink({
  ticker,
  name,
  className,
}: {
  ticker: string;
  name?: string;
  className?: string;
}) {
  if (!name) {
    return (
      <Link href={`/${ticker}`} className={className}>
        {ticker}
      </Link>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <Link {...props} href={`/${ticker}`} className={className}>
            {ticker}
          </Link>
        )}
      />
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
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

  const sorted = useMemo(
    () =>
      [...results].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (typeof av === 'string' && typeof bv === 'string') {
          return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        if (typeof av === 'number' && typeof bv === 'number') {
          return sortDir === 'asc' ? av - bv : bv - av;
        }
        return 0;
      }),
    [results, sortKey, sortDir]
  );

  function sortIndicator(key: SortKey): string {
    if (key !== sortKey) return '';
    return sortDir === 'asc' ? ' ^' : ' v';
  }

  return (
    <>
      {/* Tablet / desktop: full table (≥640px) */}
      <div className="hidden sm:block">
        <Table aria-label="Stock screener results">
          <TableHeader>
            <TableRow>
              {COLUMNS.map(({ key, label }) => (
                <TableHead
                  key={key}
                  className="text-muted-foreground font-normal cursor-pointer select-none hover:text-foreground font-mono text-xs whitespace-nowrap"
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
                </TableHead>
              ))}
              <TableHead className="text-muted-foreground font-normal font-mono text-xs whitespace-nowrap">
                PATTERNS
              </TableHead>
              <TableHead className="text-muted-foreground font-normal font-mono text-xs whitespace-nowrap">
                ACTION
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => (
              <TableRow key={row.ticker} className={rowBorderColor(row.opinion)}>
                <TableCell className="font-bold font-mono text-xs text-foreground">
                  <TickerLink
                    ticker={row.ticker}
                    name={row.name}
                    className="hover:text-primary transition-colors"
                  />
                </TableCell>
                <TableCell className="tabular-nums font-mono text-xs text-right text-foreground">
                  {row.close.toFixed(2)}
                </TableCell>
                <TableCell className="tabular-nums font-mono text-xs text-right">
                  <span className={rsiColorClass(row.rsi)}>{row.rsi.toFixed(1)}</span>
                </TableCell>
                <TableCell>
                  <ScoreBar value={row.score} />
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1">
                    <SignalBadge signal={row.opinion as 'BUY' | 'SELL' | 'HOLD'} />
                    {row.opinion === 'BUY' && (
                      <EarningsWarningBadge daysToEarnings={row.daysToEarnings} />
                    )}
                  </span>
                </TableCell>
                <TableCell className="max-w-[300px]">
                  <PatternList patterns={row.patterns} />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/${row.ticker}`}
                    className="text-primary hover:underline text-xs font-mono"
                    aria-label={`View details for ${row.ticker}`}
                  >
                    DETAIL
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: card list (<640px) */}
      <div className="sm:hidden">
        <div
          className="flex flex-wrap items-center gap-1 border-b border-border p-2"
          role="toolbar"
          aria-label="Sort screener results"
        >
          <span className="mr-1 font-mono text-[10px] text-muted-foreground">SORT</span>
          {COLUMNS.map(({ key, label }) => (
            <Button
              key={key}
              type="button"
              variant={sortKey === key ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 font-mono text-[10px]"
              aria-pressed={sortKey === key}
              onClick={() => handleSort(key)}
            >
              {label}
              <span aria-hidden="true">{sortIndicator(key)}</span>
            </Button>
          ))}
        </div>
        <ul aria-label="Stock screener results" className="divide-y divide-border">
          {sorted.map((row) => (
            <li key={row.ticker} className={`p-3 ${rowBorderColor(row.opinion)}`}>
              <div className="flex items-center justify-between gap-2">
                <TickerLink
                  ticker={row.ticker}
                  name={row.name}
                  className="font-bold font-mono text-sm text-foreground hover:text-primary"
                />
                <span className="inline-flex items-center gap-1">
                  <SignalBadge signal={row.opinion as 'BUY' | 'SELL' | 'HOLD'} />
                  {row.opinion === 'BUY' && (
                    <EarningsWarningBadge daysToEarnings={row.daysToEarnings} />
                  )}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-xs text-muted-foreground">
                <span>
                  CLOSE <span className="tabular-nums text-foreground">{row.close.toFixed(2)}</span>
                </span>
                <span>
                  RSI{' '}
                  <span className={`tabular-nums ${rsiColorClass(row.rsi)}`}>
                    {row.rsi.toFixed(1)}
                  </span>
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="w-12 font-mono text-[10px] text-muted-foreground">SCORE</span>
                <ScoreBar value={row.score} />
              </div>
              <div className="mt-2">
                <PatternList patterns={row.patterns} />
              </div>
              <div className="mt-2">
                <Link
                  href={`/${row.ticker}`}
                  className="font-mono text-xs text-primary hover:underline"
                  aria-label={`View details for ${row.ticker}`}
                >
                  DETAIL &rarr;
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
