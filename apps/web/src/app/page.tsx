import { DEFAULT_SCREENER_TICKERS } from '@stock-checker/core/src/constants/screener';
import { MarketHeatmap } from '@/components/market-heatmap';
import { ScreenerTable } from '@/components/screener-table';
import { ScreenerTableSkeleton } from '@/components/screener-table-skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getScreenerResponse, type ScreenerResponse } from '@/lib/api';

const TICKERS = [...DEFAULT_SCREENER_TICKERS];

export default async function ScreenerPage() {
  let response: ScreenerResponse | undefined;
  let error: string | null = null;

  try {
    response = await getScreenerResponse(TICKERS);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to fetch screener data';
  }
  const results = response?.results;
  const unavailable = response?.unavailable ?? [];
  const generatedAt = response?.generatedAt;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-sm font-bold font-mono tracking-widest text-primary">
          EQUITY SCREENER — {TICKERS.length} SYMBOLS
        </h1>
        <span className="text-xs font-mono text-muted-foreground">
          {generatedAt
            ? `생성 ${generatedAt.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}`
            : new Date().toISOString().split('T')[0]}
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
            <ScreenerTableSkeleton />
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
                {results.length} RESULTS · 세션 날짜는 종목별 완료 세션이며 STALE 표시는 최신
                세션보다 오래된 행입니다
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <ScreenerTable results={results} />
            </CardContent>
          </Card>

          {(unavailable.length > 0 || results.length < TICKERS.length) && (
            <Alert>
              <AlertTitle className="font-mono text-xs font-bold">
                UNAVAILABLE · {Math.max(unavailable.length, TICKERS.length - results.length)}
              </AlertTitle>
              <AlertDescription className="font-mono text-xs">
                {unavailable.length > 0 ? (
                  <ul className="list-disc pl-4">
                    {unavailable.map((item) => (
                      <li key={item.ticker}>
                        <span className="font-bold text-foreground">{item.ticker}</span>:{' '}
                        {item.reason}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    {TICKERS.filter((t) => !results.some((r) => r.ticker === t)).join(', ')}: 분석
                    결과가 반환되지 않았습니다 (HOLD가 아니라 데이터 없음).
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
