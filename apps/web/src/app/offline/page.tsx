import { Card, CardContent } from '@/components/ui/card';

export const metadata = {
  title: 'Offline — Stock Screener',
};

export default function OfflinePage() {
  return (
    <div className="flex justify-center pt-16">
      <Card className="max-w-sm w-full">
        <CardContent className="py-8 text-center space-y-2">
          <p className="font-mono text-sm font-bold tracking-widest text-warning">OFFLINE</p>
          <p className="font-mono text-xs text-muted-foreground">
            네트워크에 연결할 수 없습니다. 스크리너·종목 상세·포트폴리오·관심종목은 항상 최신 세션을
            네트워크에서 읽기 때문에 오프라인에서는 표시하지 않습니다. 이전 신호가 현재 신호로
            보이지 않도록 하기 위한 조치입니다. 다시 연결한 뒤 새로고침하세요.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
