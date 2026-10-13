import Link from 'next/link';
import { ValidatedStrategyNote } from '@/components/common/validated-strategy-note';
import { BacktestPlayground } from '@/features/backtest/components/backtest-playground';

interface PageProps {
  params: Promise<{ ticker: string }>;
}

export default async function BacktestPage({ params }: PageProps) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/${symbol}`}
          className="text-xs font-mono text-muted-foreground hover:text-primary"
        >
          &lt; BACK TO {symbol}
        </Link>
      </div>

      <div className="border border-border bg-card p-4">
        <h1 className="text-xl font-bold font-mono text-foreground tracking-widest">
          {symbol} — BACKTEST PLAYGROUND
        </h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          Same engine as the CLI backtest (5y daily, quality pipeline), running locally in your
          browser.
        </p>
        <p className="mt-2 font-mono text-xs text-muted-foreground" lang="ko">
          단일 종목 백테스트는 보통 0~3건의 거래만 만들어 내므로 결론을 내릴 수 없습니다. 아래
          유니버스 전체 검증값과 함께 읽고, 재측정은{' '}
          <code className="text-foreground">mise run strategy:validate</code> 로 수행하세요.
        </p>
        <ValidatedStrategyNote className="mt-3" />
      </div>

      <BacktestPlayground ticker={symbol} />
    </div>
  );
}
