'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EarningsWarningBadge } from '@/components/common/earnings-warning-badge';
import { PatternList } from '@/components/pattern-list';
import { ScoreBar } from '@/components/score-bar';
import { SignalBadge } from '@/components/signal-badge';
import { Badge } from '@/components/ui/badge';
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
import {
  INDICATOR_ZONES,
  indicatorZone,
  ZONE_LABEL,
  ZONE_SHORT_LABEL,
  zoneTextClass,
} from '@/lib/indicator-zones';
import { latestSessionDate, sessionStaleness } from '@/lib/session-staleness';
import {
  deriveSignalVisual,
  type SignalThresholds,
  signalThresholdsFromConfig,
  toneBorderClass,
} from '@/lib/signal-visuals';

type SortKey = 'ticker' | 'date' | 'close' | 'rsi' | 'score' | 'opinion';
type SortDir = 'asc' | 'desc';

interface ScreenerTableProps {
  results: TickerResult[];
  /** Frozen thresholds; defaults to the shipped config (or the row's own pipelineConfig). */
  thresholds?: SignalThresholds | null;
  /** Injectable clock for staleness checks (tests). */
  today?: Date;
}

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'ticker', label: 'TICKER' },
  { key: 'date', label: 'SESSION' },
  { key: 'close', label: 'CLOSE' },
  { key: 'rsi', label: 'RSI' },
  { key: 'score', label: 'SCORE' },
  { key: 'opinion', label: 'SIGNAL' },
];

function priceText(row: TickerResult): string {
  const currency = row.currency?.toUpperCase();
  const value = row.close.toFixed(2);
  return currency && currency !== 'USD' ? `${value} ${currency}` : value;
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

function RsiValue({ rsi }: { rsi: number }) {
  const zone = indicatorZone(rsi, INDICATOR_ZONES.rsi);
  return (
    <span className={`tabular-nums ${zoneTextClass(zone)}`}>
      {rsi.toFixed(1)}
      {zone !== 'neutral' && (
        <abbr
          title={ZONE_LABEL[zone]}
          aria-label={ZONE_LABEL[zone]}
          className="ml-1 text-[10px] tracking-widest no-underline"
        >
          {ZONE_SHORT_LABEL[zone]}
        </abbr>
      )}
    </span>
  );
}

function SessionCell({
  date,
  latest,
  today,
}: {
  date: string;
  latest: string | null;
  today?: Date;
}) {
  const staleness = sessionStaleness(date, { today, latest });
  return (
    <span className="inline-flex flex-wrap items-center gap-1 tabular-nums">
      <span>{date}</span>
      {staleness.stale && (
        <Badge
          variant="outline"
          className="h-4 rounded-sm border-warning/60 px-1 font-mono text-[10px] tracking-widest text-warning"
          title={staleness.message}
          aria-label={`Stale session: ${staleness.message}`}
        >
          STALE
        </Badge>
      )}
    </span>
  );
}

export function ScreenerTable({ results, thresholds, today }: ScreenerTableProps) {
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
  const latest = useMemo(() => latestSessionDate(results.map((r) => r.date)), [results]);
  const rowThresholds = (row: TickerResult) =>
    thresholds ?? (row.pipelineConfig ? signalThresholdsFromConfig(row.pipelineConfig) : null);
  const visualOf = (row: TickerResult) =>
    deriveSignalVisual({
      decision: row.opinion,
      score: row.score,
      buyScore: row.buyScore,
      thresholds: rowThresholds(row),
    });

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
                  className="p-0 text-muted-foreground font-normal font-mono text-xs whitespace-nowrap"
                  aria-sort={
                    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  <button
                    type="button"
                    onClick={() => handleSort(key)}
                    className="h-full w-full cursor-pointer select-none px-2 py-2 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    {label}
                    <span aria-hidden="true">{sortIndicator(key)}</span>
                  </button>
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
            {sorted.map((row) => {
              const visual = visualOf(row);
              return (
                <TableRow key={row.ticker} className={toneBorderClass(visual.tone)}>
                  <TableCell className="font-bold font-mono text-xs text-foreground">
                    <TickerLink
                      ticker={row.ticker}
                      name={row.name}
                      className="hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    <SessionCell date={row.date} latest={latest} today={today} />
                  </TableCell>
                  <TableCell className="tabular-nums font-mono text-xs text-right text-foreground">
                    {priceText(row)}
                  </TableCell>
                  <TableCell className="tabular-nums font-mono text-xs text-right">
                    <RsiValue rsi={row.rsi} />
                  </TableCell>
                  <TableCell>
                    <ScoreBar
                      value={row.score}
                      decision={row.opinion}
                      buyScore={row.buyScore}
                      thresholds={rowThresholds(row)}
                      showLabel={false}
                    />
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1">
                      <SignalBadge
                        signal={row.opinion as 'BUY' | 'SELL' | 'HOLD'}
                        blocked={visual.state === 'blocked'}
                      />
                      {row.opinion === 'BUY' && (
                        <EarningsWarningBadge
                          daysToEarnings={row.daysToEarnings}
                          nextEarningsDate={row.nextEarningsDate}
                        />
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    <PatternList patterns={row.patterns} />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/${row.ticker}`}
                      className="text-primary hover:underline text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`View details for ${row.ticker}`}
                    >
                      DETAIL
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
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
          {sorted.map((row) => {
            const visual = visualOf(row);
            return (
              <li key={row.ticker} className={`p-3 ${toneBorderClass(visual.tone)}`}>
                <div className="flex items-center justify-between gap-2">
                  <TickerLink
                    ticker={row.ticker}
                    name={row.name}
                    className="font-bold font-mono text-sm text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <span className="inline-flex items-center gap-1">
                    <SignalBadge
                      signal={row.opinion as 'BUY' | 'SELL' | 'HOLD'}
                      blocked={visual.state === 'blocked'}
                    />
                    {row.opinion === 'BUY' && (
                      <EarningsWarningBadge
                        daysToEarnings={row.daysToEarnings}
                        nextEarningsDate={row.nextEarningsDate}
                      />
                    )}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  SESSION <SessionCell date={row.date} latest={latest} today={today} />
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-xs text-muted-foreground">
                  <span>
                    CLOSE <span className="tabular-nums text-foreground">{priceText(row)}</span>
                  </span>
                  <span>
                    RSI <RsiValue rsi={row.rsi} />
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="w-12 font-mono text-[10px] text-muted-foreground">SCORE</span>
                  <ScoreBar
                    value={row.score}
                    decision={row.opinion}
                    buyScore={row.buyScore}
                    thresholds={rowThresholds(row)}
                  />
                </div>
                <div className="mt-2">
                  <PatternList patterns={row.patterns} />
                </div>
                <div className="mt-2">
                  <Link
                    href={`/${row.ticker}`}
                    className="font-mono text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`View details for ${row.ticker}`}
                  >
                    DETAIL &rarr;
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
