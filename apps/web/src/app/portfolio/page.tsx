import { PortfolioControls } from '@/components/portfolio-controls';
import { ScreenerTable } from '@/components/screener-table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getPortfolio, getScreener } from '@/lib/api';

export default async function PortfolioPage() {
  let tickers: string[] = [];
  let error: string | null = null;

  try {
    tickers = await getPortfolio();
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to fetch portfolio';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-sm font-bold font-mono tracking-widest text-primary">
          PORTFOLIO — {tickers.length} SYMBOLS
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
      ) : (
        <>
          <Card className="mb-4">
            <CardHeader className="border-b border-border py-1.5 px-3">
              <span className="text-[10px] font-mono text-muted-foreground">MANAGE HOLDINGS</span>
            </CardHeader>
            <CardContent className="pt-3">
              <PortfolioControls tickers={tickers} />
            </CardContent>
          </Card>

          {tickers.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="font-mono text-xs text-muted-foreground">
                  No holdings yet. Add a ticker to start tracking.
                </p>
              </CardContent>
            </Card>
          ) : (
            <PortfolioHoldings tickers={tickers} />
          )}
        </>
      )}
    </div>
  );
}

async function PortfolioHoldings({ tickers }: { tickers: string[] }) {
  let results: Awaited<ReturnType<typeof getScreener>> | undefined;
  let error: string | null = null;

  try {
    results = await getScreener(tickers);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to fetch screener data';
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle className="font-mono text-xs font-bold">ERROR</AlertTitle>
        <AlertDescription className="font-mono text-xs">{error}</AlertDescription>
      </Alert>
    );
  }

  if (!results || results.length === 0) {
    return <div className="p-4 font-mono text-xs text-muted-foreground">NO DATA AVAILABLE</div>;
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border py-1.5 px-3">
        <span className="text-[10px] font-mono text-muted-foreground">
          {results.length} RESULTS — SORTED BY SCORE DESC BY DEFAULT
        </span>
      </CardHeader>
      <CardContent className="p-0">
        <ScreenerTable results={results} />
      </CardContent>
    </Card>
  );
}
