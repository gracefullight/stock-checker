import Link from 'next/link';
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
      </div>

      <BacktestPlayground ticker={symbol} />
    </div>
  );
}
