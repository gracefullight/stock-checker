import { Skeleton } from '@/components/ui/skeleton';

/** Loading placeholder shared by the screener, portfolio and watchlist pages. */
export function ScreenerTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-live="polite" aria-label="Loading screener data">
      <div className="flex gap-2 px-2 py-1.5 border-b border-border">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-16" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-2 px-2 py-1.5">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
