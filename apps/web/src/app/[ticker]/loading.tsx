import { Skeleton } from '@/components/ui/skeleton';

export default function TickerDetailLoading() {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-label="Loading ticker detail">
      <Skeleton className="h-4 w-32" />
      <div className="border border-border bg-card p-4 space-y-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-[420px] w-full rounded-none" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Skeleton className="h-48 w-full rounded-none" />
        <Skeleton className="h-48 w-full rounded-none" />
      </div>
      <span className="sr-only">분석 중…</span>
    </div>
  );
}
