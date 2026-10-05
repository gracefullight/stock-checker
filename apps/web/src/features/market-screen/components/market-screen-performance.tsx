'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  formatPaperPercentage,
  formatPaperPrice,
  formatPaperSession,
  formatPaperTimestamp,
} from '@/features/market-screen/utils/market-screen-performance-format';
import { useMarketScreenPerformance } from '@/features/market-screen/utils/use-market-screen-performance';

export function MarketScreenPerformance({ jobId }: { jobId: string }) {
  const state = useMarketScreenPerformance(jobId);
  const snapshot = state.snapshot;
  const summary = snapshot?.summary;
  const page = snapshot?.page.offset === state.offset ? snapshot.page : null;
  const backgroundRunning = snapshot?.refresh.status === 'running';
  const busy = state.refreshing || backgroundRunning;

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="gap-3 border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-sm font-mono">FORWARD PAPER OUTCOMES</CardTitle>
          <Button
            variant="outline"
            size="sm"
            disabled={!snapshot || state.loading || !!state.readError || busy}
            onClick={() => void state.refresh()}
          >
            {busy ? 'Refreshing performance...' : 'Refresh performance'}
          </Button>
        </div>
        <p className="text-base text-muted-foreground sm:text-sm">
          Frozen BUY paper outcomes, not broker executions: next trading session open to fifth
          session close, minus 10 bps (0.10%) total round-trip costs.
        </p>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {state.readError && (
          <Alert variant="destructive">
            <AlertTitle>Saved outcomes could not be read</AlertTitle>
            <AlertDescription>
              {state.readError} {snapshot && 'Displayed outcomes may be stale.'}
              <Button variant="outline" size="sm" onClick={state.retryRead} className="mt-2">
                Retry saved outcomes
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {state.refreshError && (
          <Alert variant="destructive">
            <AlertTitle>Performance refresh request failed</AlertTitle>
            <AlertDescription>
              {state.refreshError} A failed request is not a paper loss. Read the saved status
              before retrying; the server may still be processing an accepted request.
            </AlertDescription>
          </Alert>
        )}
        {!snapshot ? (
          <p role="status" className="text-sm text-muted-foreground">
            {state.readError
              ? 'Saved paper outcomes are unavailable.'
              : 'Loading saved paper outcomes...'}
          </p>
        ) : (
          <>
            <p className="text-xs font-mono text-muted-foreground break-words">
              LAST SAVED UPDATE: {formatPaperTimestamp(snapshot.updatedAt)}
            </p>
            {summary && (
              <>
                <dl className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 lg:grid-cols-4">
                  {[
                    ['Saved BUY recommendations', summary.totalRecommendations],
                    [
                      'New-policy BUY records',
                      summary.totalRecommendations - summary.legacyUntracked,
                    ],
                    ['Completed samples', summary.completed],
                    [
                      'Completed-sample win rate',
                      formatPaperPercentage(summary.completed > 0 ? summary.winRatePct : null),
                    ],
                    [
                      'Wins / Losses / Breakeven',
                      `${summary.wins} / ${summary.losses} / ${summary.breakeven}`,
                    ],
                    [
                      'Mean completed net return',
                      formatPaperPercentage(
                        summary.completed > 0 ? summary.averageNetReturnPct : null
                      ),
                    ],
                    ['Pending / Open', `${summary.pending} / ${summary.open}`],
                    [
                      'Unavailable / Ineligible / Legacy',
                      `${summary.unavailable} / ${summary.ineligible} / ${summary.legacyUntracked}`,
                    ],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0 rounded-md border border-border p-3">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="mt-1 break-words font-mono text-lg tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
                {summary.completed === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No completed forward samples yet. No verified forward win rate is available.
                  </p>
                )}
              </>
            )}
            {backgroundRunning && (
              <p role="status" className="text-sm text-muted-foreground">
                Background refresh: {snapshot.refresh.processed} / {snapshot.refresh.selected}{' '}
                records processed. Saved outcomes will update through read-only polling.
              </p>
            )}
            {snapshot.refresh.reason && (
              <p className="text-sm text-muted-foreground">{snapshot.refresh.reason}</p>
            )}
            <div aria-busy={state.loading} className="min-w-0 space-y-3">
              {!page ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Loading this saved outcomes page...
                </p>
              ) : page.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No saved BUY outcome records on this page.
                </p>
              ) : (
                <Table aria-label="Forward paper outcome records">
                  <TableHeader>
                    <TableRow>
                      <TableHead>TICKER / STATUS</TableHead>
                      <TableHead>RECOMMENDED (UTC) / DATA SESSION</TableHead>
                      <TableHead>ENTRY SESSION / PRICE (USD)</TableHead>
                      <TableHead>EXIT SESSION / PRICE (USD)</TableHead>
                      <TableHead className="text-right">NET RETURN / OUTCOME</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {page.items.map((row) => (
                      <TableRow key={row.recommendationId}>
                        <TableCell>
                          <div className="font-mono font-bold">{row.ticker}</div>
                          <Badge variant="outline" className="mt-1">
                            {row.status.toUpperCase()}
                          </Badge>
                          {row.reason && (
                            <p className="mt-1 max-w-64 whitespace-normal text-xs text-muted-foreground">
                              {row.reason}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">
                          <div>{formatPaperTimestamp(row.recommendedAt)}</div>
                          <div className="mt-1 text-muted-foreground">
                            Data: {formatPaperSession(row.dataAsOf)}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          <div>{formatPaperSession(row.entryDate)}</div>
                          {row.entryDate && row.status !== 'completed' && row.status !== 'open' && (
                            <div className="text-xs text-muted-foreground">Scheduled session</div>
                          )}
                          <div className="mt-1 text-muted-foreground">
                            {formatPaperPrice(row.entryPrice)}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          <div>{formatPaperSession(row.exitDate)}</div>
                          {row.exitDate && row.status !== 'completed' && (
                            <div className="text-xs text-muted-foreground">Scheduled session</div>
                          )}
                          <div className="mt-1 text-muted-foreground">
                            {formatPaperPrice(row.exitPrice)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          <div>
                            {formatPaperPercentage(
                              row.status === 'completed' ? row.netReturnPct : null
                            )}
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            {row.status === 'completed' ? (row.outcome?.toUpperCase() ?? '—') : '—'}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {page && (
                <nav
                  aria-label="Paper outcome pagination"
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <span className="text-xs font-mono tabular-nums text-muted-foreground">
                    {page.items.length ? page.offset + 1 : 0}–{page.offset + page.items.length} OF{' '}
                    {page.total} RECORDS
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={state.loading || busy || state.offset === 0}
                      onClick={() => state.setOffset(Math.max(0, state.offset - page.limit))}
                    >
                      Previous outcomes
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={state.loading || busy || !page.hasMore}
                      onClick={() => state.setOffset(state.offset + page.limit)}
                    >
                      Next outcomes
                    </Button>
                  </div>
                </nav>
              )}
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Outcome definitions and data refresh
              </summary>
              <p className="mt-2 text-muted-foreground">
                Win rate = wins / completed samples, including breakeven in the denominator;
                pending, open, unavailable, ineligible and legacy records are excluded. Legacy
                results were not tracked prospectively; unavailable data is not a 0% result or a
                loss, and signal scores are not win probabilities. Prices are USD from the same
                fetched adjusted series; session dates use America/New_York. Reads and automatic
                polling use saved outcomes only. Refresh performance requests prices for up to 20
                eligible records and does not resume candidate screening.
              </p>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
