'use client';

import { useEffect, useMemo, useState } from 'react';
import { ValidatedStrategyNote } from '@/components/common/validated-strategy-note';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { MarketScreenPerformance } from '@/features/market-screen/components/market-screen-performance';
import { MarketScreenResults } from '@/features/market-screen/components/market-screen-results';
import {
  isStalePausedJob,
  isValidatedUniverseJob,
  jobOrigin,
  jobSessionDate,
  universeLabel,
} from '@/features/market-screen/utils/market-screen-universe';
import {
  MARKET_SCREEN_PAGE_SIZE,
  useMarketScreenDashboard,
} from '@/features/market-screen/utils/use-market-screen-dashboard';

const FILTER_LABELS: Record<string, string> = {
  ind_stocksonly: 'Stocks only · funds excluded',
  ta_sma50_pb: 'Price below SMA50',
  cap_midover: 'Market cap over $2B',
  sh_avgvol_o500: 'Average volume over 500k shares',
  sh_price_o5: 'Price over $5',
};
const HIDE_STALE_STORAGE_KEY = 'market-screen-hide-stale-paused';

function publicSource(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'finviz.com' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ['/screener', '/screener.ashx'].includes(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
const date = (value: string) => value.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
const terminal = (status: string) => ['completed', 'partial', 'unavailable'].includes(status);

function RequestError({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: string;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Retry refresh
        </Button>
      </AlertDescription>
    </Alert>
  );
}

interface MarketScreenDashboardProps {
  /** Job id from the `?job=` deep link. */
  initialJobId?: string | null;
  /** Injectable clock for stale-job filtering (tests). */
  now?: () => number;
}

export function MarketScreenDashboard({ initialJobId = null, now }: MarketScreenDashboardProps) {
  const state = useMarketScreenDashboard({ initialJobId });
  const { jobs, snapshot } = state;
  const job = snapshot?.job;
  const processed = job ? job.progress.analyzed + job.progress.unavailable : 0;
  const source = job ? publicSource(job.universe.url) : null;
  const [hideStale, setHideStale] = useState(false);
  useEffect(() => {
    try {
      setHideStale(window.localStorage.getItem(HIDE_STALE_STORAGE_KEY) === '1');
    } catch {
      /* private mode etc. */
    }
  }, []);
  function toggleHideStale(checked: boolean) {
    setHideStale(checked);
    try {
      window.localStorage.setItem(HIDE_STALE_STORAGE_KEY, checked ? '1' : '0');
    } catch {
      /* selection just won't persist */
    }
  }
  const nowMs = now ? now() : Date.now();
  const visibleJobs = useMemo(
    () =>
      jobs?.jobs.filter(
        (saved) => !hideStale || saved.id === state.selectedId || !isStalePausedJob(saved, nowMs)
      ) ?? [],
    [jobs, hideStale, nowMs, state.selectedId]
  );
  const hiddenCount = (jobs?.jobs.length ?? 0) - visibleJobs.length;
  const deepLinkMissing =
    !!initialJobId && !!jobs && !jobs.jobs.some((saved) => saved.id === initialJobId);
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-sm font-bold font-mono tracking-widest text-primary">MARKET SCREEN</h1>
        <span className="text-xs font-mono text-muted-foreground">
          SAVED CANDIDATE JOBS → STOCK CHECKER
        </span>
      </div>
      <p className="text-base text-muted-foreground sm:text-sm">
        Read saved candidate jobs created with Stock Checker MCP or the daily report. Opening this
        page only reads progress; analysis starts when you choose Resume. Deep link:{' '}
        <code className="font-mono text-xs">/market-screen?job=&lt;id&gt;</code>.
      </p>
      <Card className="min-w-0">
        <CardHeader className="gap-3 border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-sm font-mono">SAVED JOBS</CardTitle>
            <div className="flex items-center gap-2">
              <Switch
                id="market-screen-hide-stale"
                size="sm"
                checked={hideStale}
                onCheckedChange={toggleHideStale}
              />
              <Label htmlFor="market-screen-hide-stale" className="text-xs">
                Hide stale paused jobs (48h+)
                {hiddenCount > 0 && (
                  <span className="font-mono text-muted-foreground">· {hiddenCount} hidden</span>
                )}
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          {state.jobsError && (
            <RequestError
              title="Job list refresh failed"
              error={state.jobsError}
              onRetry={state.retryList}
            />
          )}
          {deepLinkMissing && (
            <p role="status" className="text-sm text-warning">
              Linked job {initialJobId} is not on this page of saved jobs; its status is loaded
              directly below if it exists.
            </p>
          )}
          {!jobs && !state.jobsError ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading saved jobs...
            </p>
          ) : jobs?.jobs.length === 0 ? (
            <p className="text-base text-muted-foreground sm:text-sm">
              No saved jobs on this page. Use prepare_finviz_screen and create_market_screen in
              Stock Checker MCP, or run the daily report, to create a saved job.
            </p>
          ) : visibleJobs.length === 0 ? (
            <p className="text-base text-muted-foreground sm:text-sm">
              All {jobs?.jobs.length} jobs on this page are stale paused jobs. Turn the toggle off
              to show them.
            </p>
          ) : (
            <ul
              className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3"
              aria-label="Saved market-screen jobs"
            >
              {visibleJobs.map((saved) => (
                <li key={saved.id} className="min-w-0">
                  <Button
                    variant={state.selectedId === saved.id ? 'secondary' : 'outline'}
                    onClick={() => state.selectJob(saved.id)}
                    aria-pressed={state.selectedId === saved.id}
                    className="h-auto w-full min-w-0 justify-start whitespace-normal p-3 text-left"
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="block font-mono text-xs">
                        {saved.criteria.decision} · {saved.status.toUpperCase()} ·{' '}
                        {saved.universe.collectedCount} CANDIDATES
                      </span>
                      <span className="block text-xs">
                        {universeLabel(saved)} · {jobOrigin(saved)}
                      </span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        US 세션 {jobSessionDate(saved) ?? 'N/A'} · #{saved.id.slice(0, 8)}
                        <span className="sr-only"> full id {saved.id}</span>
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Updated {date(saved.updatedAt)}
                        {isStalePausedJob(saved, nowMs) && ' · STALE PAUSED'}
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {jobs && (
            <nav
              aria-label="Job pagination"
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span className="text-xs font-mono tabular-nums text-muted-foreground">
                {jobs.total} SAVED JOBS
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={state.jobsOffset === 0}
                  onClick={() =>
                    state.setJobsOffset(Math.max(0, state.jobsOffset - MARKET_SCREEN_PAGE_SIZE))
                  }
                >
                  Previous jobs
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!jobs.hasMore}
                  onClick={() => state.setJobsOffset(state.jobsOffset + MARKET_SCREEN_PAGE_SIZE)}
                >
                  Next jobs
                </Button>
              </div>
            </nav>
          )}
        </CardContent>
      </Card>
      {state.jobError && (
        <>
          <RequestError
            title="Job status refresh failed"
            error={state.jobError}
            onRetry={state.retryJob}
          />
          {job && (
            <p role="status" className="text-sm text-warning">
              Showing the last successful snapshot. Status may be stale; controls are disabled until
              refresh succeeds.
            </p>
          )}
        </>
      )}
      {state.actionError && (
        <RequestError
          title="Job control failed"
          error={state.actionError}
          onRetry={state.retryJob}
        />
      )}
      {state.selectedId && !job && !state.jobError && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading selected job...
        </p>
      )}
      {job && (
        <>
          <Card className="min-w-0">
            <CardHeader className="gap-3 border-b border-border">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-sm font-mono">JOB PROGRESS</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{job.status.toUpperCase()}</Badge>
                  <Badge variant="outline">{universeLabel(job)}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={state.retryJob}
                    disabled={!!state.pendingAction}
                  >
                    Refresh status
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !!state.pendingAction ||
                      !!state.jobError ||
                      state.jobLoading ||
                      terminal(job.status) ||
                      job.status === 'paused'
                    }
                    onClick={() => void state.control('pause')}
                  >
                    {state.pendingAction === 'pause' ? 'Pausing...' : 'Pause'}
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      !!state.pendingAction ||
                      !!state.jobError ||
                      state.jobLoading ||
                      terminal(job.status) ||
                      job.status === 'running'
                    }
                    onClick={() => void state.control('resume')}
                  >
                    {state.pendingAction === 'resume' ? 'Resuming...' : 'Resume'}
                  </Button>
                </div>
              </div>
              <p className="break-all text-xs font-mono text-muted-foreground">
                {jobOrigin(job)} · US 세션 {jobSessionDate(job) ?? 'N/A'} · {job.id}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={processed} max={job.progress.total}>
                <ProgressLabel>Processed candidates</ProgressLabel>
                <ProgressValue>{() => `${processed} / ${job.progress.total}`}</ProgressValue>
              </Progress>
              <dl className="grid grid-cols-2 gap-4 font-mono tabular-nums sm:grid-cols-5">
                {[
                  ['ANALYZED', job.progress.analyzed],
                  ['UNAVAILABLE', job.progress.unavailable],
                  ['PENDING', job.progress.pending],
                  ['IN FLIGHT', job.progress.inFlight],
                  [
                    job.criteria.decision === 'BUY'
                      ? 'BUY MATCHES'
                      : `${job.criteria.decision} MATCHES`,
                    job.progress.matched,
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 text-xl">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm text-muted-foreground">
                History: {job.criteria.lookbackDays} calendar days. Last checkpoint:{' '}
                {date(job.updatedAt)}.
                {job.criteria.pipelineConfig
                  ? ' Frozen pipeline configuration attached.'
                  : ' Legacy job without a frozen configuration; default thresholds are shown.'}
              </p>
              {job.pauseReason && (
                <p role="status" className="text-base text-warning sm:text-sm">
                  {job.pauseReason}
                </p>
              )}
              <p className="text-base text-muted-foreground sm:text-sm">
                Pause stops new launches. In-progress analyses keep their slots and may finish after
                the pause request.
              </p>
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-sm font-mono">CANDIDATE SOURCE</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {isValidatedUniverseJob(job) ? 'CONFIGURED UNIVERSE' : 'FINVIZ'} ·{' '}
                  {job.universe.completeness.toUpperCase()}
                </Badge>
                <Badge variant={isValidatedUniverseJob(job) ? 'secondary' : 'outline'}>
                  {universeLabel(job)}
                </Badge>
                <span className="font-mono text-sm tabular-nums">
                  {job.universe.collectedCount} / {job.universe.sourceTotal} FILTERED CANDIDATES
                  COLLECTED
                </span>
              </div>
              {!isValidatedUniverseJob(job) && (
                <p className="text-sm text-warning" lang="ko">
                  Finviz 후보는 검증 유니버스(538종목 재측정) 밖의 모집단입니다. 아래 검증 통계는 이
                  작업의 후보 집합에 그대로 적용되지 않습니다.
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Captured: {date(job.universe.capturedAt)}. Completeness is caller-declared; counts
                do not independently verify source coverage.
              </p>
              <ul className="flex flex-wrap gap-2" aria-label="Source filters">
                {job.universe.filters.map((filter, index) => (
                  <li key={String(index) + filter}>
                    <Badge variant="secondary" className="max-w-full whitespace-normal break-all">
                      {FILTER_LABELS[filter] ?? filter}
                    </Badge>
                  </li>
                ))}
              </ul>
              {!isValidatedUniverseJob(job) && !job.universe.filters.includes('ta_sma50_pb') && (
                <p className="text-sm text-muted-foreground">
                  No below-SMA50 candidate cut is recorded for this job.
                </p>
              )}
              {source && (
                <a
                  href={source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Open saved Finviz source filters
                </a>
              )}
              <p className="text-base text-muted-foreground sm:text-sm">
                The candidate source selects candidates. The Stock Checker final decision determines
                matches. Intraday quotes, price adjustments and averaging periods can differ;
                optional size, price and volume cuts are not engine BUY rules.
              </p>
              <details className="text-sm">
                <summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Coverage and interpretation notes
                </summary>
                <ul className="mt-2 list-disc space-y-2 pl-4 text-muted-foreground">
                  {job.warnings.map((warning, index) => (
                    <li key={String(index) + warning}>{warning}</li>
                  ))}
                </ul>
              </details>
            </CardContent>
          </Card>
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-sm font-mono">
                SAVED ENGINE RESULTS · {job.criteria.decision}
              </CardTitle>
            </CardHeader>
            <CardContent className="min-w-0">
              <MarketScreenResults
                snapshot={snapshot}
                kind={state.kind}
                offset={state.offset}
                loading={state.jobLoading}
                nearMissView={state.nearMissView}
                onKindChange={state.selectKind}
                onOffsetChange={state.setOffset}
              />
            </CardContent>
          </Card>
          <ValidatedStrategyNote
            perSample={[
              { label: '이 작업 BUY 매치', value: String(job.progress.matched) },
              { label: '이 작업 후보 수', value: String(job.progress.total) },
            ]}
          />
          <MarketScreenPerformance key={job.id} jobId={job.id} />
        </>
      )}
    </div>
  );
}
