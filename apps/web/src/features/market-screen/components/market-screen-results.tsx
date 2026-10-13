/* biome-ignore-all lint/a11y/noNoninteractiveTabindex: The ARIA tabpanel is intentionally focusable so keyboard users can reach empty and loading results. */
'use client';

import Link from 'next/link';
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
import {
  type NearMissTierInfo,
  sortByNearMiss,
} from '@/features/market-screen/utils/classify-near-miss';
import type { MarketScreenJobSnapshot, MarketScreenResultKind, StockScreenMatch } from '@/lib/api';
import { describeBlock, translateGateReason } from '@/lib/signal-reasons.locale';
import { deriveSignalVisual, signalThresholdsFromConfig } from '@/lib/signal-visuals';

const TABS: Array<{ kind: MarketScreenResultKind; label: string }> = [
  { kind: 'matches', label: 'MATCHED' },
  { kind: 'excluded', label: 'NEAR MISS · EXCLUDED' },
  { kind: 'unavailable', label: 'UNAVAILABLE' },
];
const number = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? 'N/A' : value.toFixed(2);

interface MarketScreenResultsProps {
  snapshot: MarketScreenJobSnapshot | null;
  kind: MarketScreenResultKind;
  offset: number;
  loading: boolean;
  /** True when the view auto-switched to near misses because no match exists. */
  nearMissView?: boolean;
  onKindChange: (kind: MarketScreenResultKind) => void;
  onOffsetChange: (offset: number) => void;
}

export function MarketScreenResults({
  snapshot,
  kind,
  offset,
  loading,
  nearMissView = false,
  onKindChange,
  onOffsetChange,
}: MarketScreenResultsProps) {
  const page =
    snapshot?.page.kind === kind && snapshot.page.offset === offset ? snapshot.page : null;
  const pending = !!snapshot && snapshot.job.progress.pending + snapshot.job.progress.inFlight > 0;
  const config = snapshot?.job.criteria.pipelineConfig;
  const thresholds = signalThresholdsFromConfig(config);
  const matches = page?.items.filter((item): item is StockScreenMatch => 'decision' in item) ?? [];
  const ranked: Array<{ item: StockScreenMatch; info: NearMissTierInfo | null }> =
    kind === 'excluded'
      ? sortByNearMiss(matches, {
          buyThreshold: thresholds.buy,
          rsMin: config?.qualityGate?.rsMin,
        })
      : matches.map((item) => ({ item, info: null }));
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
      {nearMissView && (
        <p role="status" className="text-sm text-warning" lang="ko">
          이 작업에는 {snapshot?.job.criteria.decision ?? 'BUY'} 매치가 없습니다. 가장 가까웠던 제외
          종목(근접 후보)을 티어 순으로 보여줍니다. 근접 후보는 추천이 아닙니다.
        </p>
      )}
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
                  {kind === 'excluded' && <TableHead>NEAR-MISS TIER</TableHead>}
                  <TableHead className="text-right">BUY SCORE</TableHead>
                  <TableHead className="text-right">SELL SCORE</TableHead>
                  <TableHead className="text-right">REFERENCE CLOSE (USD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranked.map(({ item, info }) => {
                  const visual = deriveSignalVisual({
                    decision: item.decision,
                    score: item.score,
                    buyScore: item.buyScore,
                    thresholds,
                  });
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
                        <SignalBadge signal={item.decision} blocked={visual.state === 'blocked'} />
                      </TableCell>
                      {info && (
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {info.label}
                          </Badge>
                          <p className="mt-1 max-w-72 whitespace-normal text-xs text-muted-foreground">
                            {info.detail}
                          </p>
                        </TableCell>
                      )}
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
              {ranked.map(({ item }) => (
                <details
                  key={item.ticker}
                  className="rounded-md border border-border px-3 py-2 text-sm"
                >
                  <summary className="cursor-pointer font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {item.ticker} — 결정 사유 (SIGNAL REASONS)
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground" lang="ko">
                    {item.blockedBy &&
                      describeBlock(item.blockedBy).map((line, index) => (
                        <li key={`block-${String(index)}${line}`} className="text-foreground">
                          {line}
                        </li>
                      ))}
                    {item.gateReasons.map((reason, index) => (
                      <li key={String(index) + reason}>{translateGateReason(reason)}</li>
                    ))}
                  </ul>
                </details>
              ))}
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
      {kind === 'excluded' && (
        <p className="text-base text-muted-foreground sm:text-sm" lang="ko">
          근접 티어는 이 페이지 안에서만 정렬됩니다 (서버는 원시 매수 점수 순으로 페이지를
          나눕니다). T1 = 점수·추세 통과 후 게이트 차단, T2 = 점수가 기준의 80% 이상, T3 = 추세와
          상대강도 통과, T4 = 추세만 통과, T5 = 추세 미통과. SMA50 풀백 여부는 구조화된 검사 결과가
          있을 때만 표시됩니다.
        </p>
      )}
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
