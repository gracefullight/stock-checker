import { MarketHeatmap } from '@/components/market-heatmap';
import { ScreenerTable } from '@/components/screener-table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getScreener } from '@/lib/api';

const TICKERS = [
  'TSLA',
  'PLTR',
  'GOOGL',
  'NVDA',
  'AAPL',
  'META',
  'AMD',
  'MSFT',
  'AMZN',
  'NFLX',
  'CRWD',
  'NET',
  'DDOG',
  'COIN',
  'SOFI',
  'XYZ',
  'SHOP',
  'UBER',
  'SNAP',
  'PINS',
];

function ScreenerSkeleton() {
  return (
    <div className="space-y-2" role="status" aria-live="polite" aria-label="Loading screener data">
      <div className="flex gap-2 px-2 py-1.5 border-b border-border">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-16" />
        ))}
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex gap-2 px-2 py-1.5">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}

export default async function ScreenerPage() {
  let results: Awaited<ReturnType<typeof getScreener>> | undefined;
  let error: string | null = null;

  try {
    results = await getScreener(TICKERS);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to fetch screener data';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-sm font-bold font-mono tracking-widest text-primary">
          EQUITY SCREENER — {TICKERS.length} SYMBOLS
        </h1>
        <span className="text-xs font-mono text-muted-foreground">
          {new Date().toISOString().split('T')[0]}
        </span>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle className="font-mono text-xs font-bold">ERROR</AlertTitle>
          <AlertDescription className="font-mono text-xs">{error}</AlertDescription>
        </Alert>
      ) : !results ? (
        <Card>
          <CardContent>
            <ScreenerSkeleton />
          </CardContent>
        </Card>
      ) : results.length === 0 ? (
        <div className="p-4 font-mono text-xs text-muted-foreground">NO DATA AVAILABLE</div>
      ) : (
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border py-1.5 px-3">
              <span className="text-[10px] font-mono font-bold tracking-widest text-primary">
                SECTOR HEATMAP
              </span>
            </CardHeader>
            <CardContent className="p-3">
              <MarketHeatmap results={results} />
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border py-1.5 px-3">
              <span className="text-[10px] font-mono text-muted-foreground">
                {results.length} RESULTS
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <ScreenerTable results={results} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
