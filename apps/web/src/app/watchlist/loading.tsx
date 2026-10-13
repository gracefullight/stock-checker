import { ScreenerTableSkeleton } from '@/components/screener-table-skeleton';
import { Card, CardContent } from '@/components/ui/card';

export default function WatchlistLoading() {
  return (
    <div>
      <h1 className="mb-4 text-sm font-bold font-mono tracking-widest text-primary">WATCHLIST</h1>
      <Card>
        <CardContent>
          <ScreenerTableSkeleton rows={4} />
        </CardContent>
      </Card>
    </div>
  );
}
