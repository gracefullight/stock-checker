import { ScreenerTableSkeleton } from '@/components/screener-table-skeleton';
import { Card, CardContent } from '@/components/ui/card';

export default function ScreenerLoading() {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-sm font-bold font-mono tracking-widest text-primary">
          EQUITY SCREENER
        </h1>
        <span className="text-xs font-mono text-muted-foreground" aria-live="polite">
          분석 중… 완료 세션 데이터를 불러오는 데 10초 이상 걸릴 수 있습니다
        </span>
      </div>
      <Card>
        <CardContent>
          <ScreenerTableSkeleton />
        </CardContent>
      </Card>
    </div>
  );
}
