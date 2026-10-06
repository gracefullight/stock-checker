/* biome-ignore-all lint/a11y/noNoninteractiveTabindex: The ARIA tabpanel is intentionally focusable so keyboard users can reach empty and loading results. */
'use client';

import type { StockScreenMatch } from '@stock-checker/core/src/reports/stock-screen.ts';
import Link from 'next/link';
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
import type { MarketScreenJobSnapshot, MarketScreenResultKind } from '@/lib/api';

const TABS: Array<{ kind: MarketScreenResultKind; label: string }> = [
  { kind: 'matches', label: 'MATCHED' },
  { kind: 'excluded', label: 'EXCLUDED' },
  { kind: 'unavailable', label: 'UNAVAILABLE' },
];
const number = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? 'N/A' : value.toFixed(2);

interface MarketScreenResultsProps {
  snapshot: MarketScreenJobSnapshot | null;
  kind: MarketScreenResultKind;
  offset: number;
  loading: boolean;
  onKindChange: (kind: MarketScreenResultKind) => void;
  onOffsetChange: (offset: number) => void;
}

export function MarketScreenResults({
  snapshot,
  kind,
  offset,
  loading,
  onKindChange,
  onOffsetChange,
}: MarketScreenResultsProps) {
  const page =
    snapshot?.page.kind === kind && snapshot.page.offset === offset ? snapshot.page : null;
  const pending = !!snapshot && snapshot.job.progress.pending + snapshot.job.progress.inFlight > 0;
  return (
    <div className="min-w-0 space-y-4">
      <div role="tablist" aria-label="Market-screen results" className="flex flex-wrap gap-2">
        {TABS.map((tab, index) => (
          <Button
            key={tab.kind}
            id={`market-screen-tab-${tab.kind}`}
            role="tab"
            aria-selected={kind === tab.kind}
            aria-controls="market-screen-result-panel"
            tabIndex={kind === tab.kind ? 0 : -1}
            variant={kind === tab.kind ? 'default' : 'outline'}
            onClick={() => onKindChange(tab.kind)}
            onKeyDown={(event) => {
              let next: number | undefined;
              if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
              if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length;
              if (event.key === 'Home') next = 0;
              if (event.key === 'End') next = TABS.length - 1;
              if (next === undefined) return;
              event.preventDefault();
              onKindChange(TABS[next].kind);
              document.getElementById(`market-screen-tab-${TABS[next].kind}`)?.focus();
            }}
            className="font-mono text-xs"
          >
            {tab.label}
          </Button>
        ))}
      </div>
      <div
        id="market-screen-result-panel"
        role="tabpanel"
        aria-labelledby={`market-screen-tab-${kind}`}
        aria-busy={loading}
        tabIndex={0}
        className="min-w-0 space-y-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {!page ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading saved results...
          </p>
        ) : page.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {pending
              ? 'No rows on this page yet. Candidate analysis is incomplete.'
              : 'No rows on this result page.'}
          </p>
        ) : kind === 'unavailable' ? (
          <ul className="space-y-3">
            {page.items.map((item) =>
              'reason' in item ? (
                <li key={item.ticker} className="rounded-md border border-border p-3 text-sm">
                  <span className="font-mono font-bold">{item.ticker}</span>
                  <p className="mt-1 text-muted-foreground">{item.reason}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Attempts: {item.attempts}. Analysis unavailable; no HOLD decision was produced.
                  </p>
                </li>
              ) : null
            )}
          </ul>
        ) : (
          <>
            <Table aria-label="Saved market-screen decisions">
              <TableHeader>
                <TableRow>
                  <TableHead>TICKER</TableHead>
                  <TableHead>SESSION</TableHead>
                  <TableHead>FINAL SIGNAL</TableHead>
                  <TableHead className="text-right">BUY SCORE</TableHead>
                  <TableHead className="text-right">SELL SCORE</TableHead>
                  <TableHead className="text-right">REFERENCE CLOSE (USD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((row) => {
                  if (!('decision' in row)) return null;
                  const item = row as StockScreenMatch;
                  return (
                    <TableRow key={item.ticker}>
                      <TableCell className="font-mono">
                        <Link
                          href={`/${encodeURIComponent(item.ticker)}`}
                          prefetch={false}
                          className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {item.ticker} <span className="sr-only">— Live ticker detail</span>
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {item.dataAsOf ?? 'N/A'}
                      </TableCell>
                      <TableCell>
                        <SignalBadge signal={item.decision} />
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {number(item.buyScore)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {number(item.sellScore)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {number(item.execution.reference?.price)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="space-y-3">
              {page.items.map((item) =>
                'decision' in item ? (
                  <details
                    key={item.ticker}
                    className="rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <summary className="cursor-pointer font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {item.ticker} — SIGNAL REASONS
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
                      {item.gateReasons.map((reason, index) => (
                        <li key={String(index) + reason}>{reason}</li>
                      ))}
                    </ul>
                  </details>
                ) : null
              )}
            </div>
          </>
        )}
        {page && (
          <nav
            aria-label="Result pagination"
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <span className="text-xs font-mono tabular-nums text-muted-foreground">
              {page.items.length ? page.offset + 1 : 0}–{page.offset + page.items.length} OF{' '}
              {page.total} {kind.toUpperCase()}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={loading || offset === 0}
                onClick={() => onOffsetChange(Math.max(0, offset - page.limit))}
              >
                Previous results
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={loading || !page.hasMore}
                onClick={() => onOffsetChange(offset + page.limit)}
              >
                Next results
              </Button>
            </div>
          </nav>
        )}
      </div>
      <p className="text-base text-muted-foreground sm:text-sm">
        Scores measure signal strength, not win or stop-loss probabilities. Future next-session
        entry prices are unknown; price and average daily price range risk references are in USD and
        use the saved completed close. SELL is a long-holder exit warning.
      </p>
      <p className="text-base text-muted-foreground sm:text-sm">
        Ticker links open live detail with current data and a 730-day history. It may differ from
        the saved job and its chosen lookback. Rankings and pages can change while a job is running.
      </p>
    </div>
  );
}
