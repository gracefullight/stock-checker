import Link from 'next/link';
import { IndicatorRow } from '@/components/indicator-row';
import { PatternList } from '@/components/pattern-list';
import { ScoreBar } from '@/components/score-bar';
import { SignalBadge } from '@/components/signal-badge';
import { TickerCharts } from '@/components/ticker-charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getTickerDetail } from '@/lib/api';

interface PageProps {
  params: Promise<{ ticker: string }>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const headingId = `section-${title.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <Card
      className="rounded-none ring-0 border border-border bg-card py-0"
      aria-labelledby={headingId}
      role="region"
    >
      <CardHeader className="px-3 py-1.5 border-b border-border rounded-none bg-muted/30">
        <CardTitle>
          <h2
            id={headingId}
            className="text-[10px] font-mono font-bold tracking-widest text-primary"
          >
            {title}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">{children}</CardContent>
    </Card>
  );
}

export default async function TickerDetailPage({ params }: PageProps) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();

  let data: Awaited<ReturnType<typeof getTickerDetail>> | undefined;
  let error: string | null = null;

  try {
    data = await getTickerDetail(symbol, ['fundamentals', 'earnings']);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to fetch ticker data';
  }

  if (error) {
    return (
      <div>
        <div className="mb-4">
          <Link href="/" className="text-xs font-mono text-muted-foreground hover:text-primary">
            &lt; BACK TO SCREENER
          </Link>
        </div>
        <div
          className="p-4 border border-destructive bg-card font-mono text-xs text-destructive"
          role="alert"
        >
          ERROR [{symbol}]: {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="font-mono text-xs text-muted-foreground" aria-live="polite">
        LOADING...
      </div>
    );
  }

  const signal = data.opinion as 'BUY' | 'SELL' | 'HOLD';

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div>
        <Link href="/" className="text-xs font-mono text-muted-foreground hover:text-primary">
          &lt; BACK TO SCREENER
        </Link>
      </div>

      {/* Header */}
      <div className="border border-border bg-card p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-3xl font-bold font-mono text-foreground tracking-widest">{symbol}</h1>
          <SignalBadge signal={signal} />
          <span className="text-2xl font-mono font-bold tabular-nums text-warning">
            ${data.close.toFixed(2)}
          </span>
          <span className="text-xs font-mono text-muted-foreground ml-auto">{data.date}</span>
        </div>
        {data.name && (
          <div className="mt-1 font-mono text-sm text-muted-foreground">{data.name}</div>
        )}
        {data.trendRegime && (
          <div className="mt-2 text-xs font-mono text-muted-foreground">
            REGIME: <span className="text-foreground">{data.trendRegime.toUpperCase()}</span>
          </div>
        )}
      </div>

      {/* Price chart + signal charts */}
      <Section title="PRICE CHART">
        <TickerCharts
          ticker={symbol}
          buyProbability={data.buyProbability}
          sellProbability={data.sellProbability}
          holdProbability={data.holdProbability}
          confidence={data.confidence}
          rsi={data.rsi}
          stochasticK={data.stochasticK}
        />
      </Section>

      {/* 2-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Indicators */}
        <Section title="TECHNICAL INDICATORS">
          <table className="w-full" aria-label="Technical indicators">
            <tbody>
              <IndicatorRow label="RSI (14)" value={data.rsi} threshold={{ buy: 50, sell: 30 }} />
              <IndicatorRow
                label="Stochastic K"
                value={data.stochasticK}
                threshold={{ buy: 50, sell: 20 }}
              />
              <IndicatorRow
                label="Williams %R"
                value={data.williamsR}
                threshold={{ sell: -80, buy: -20 }}
              />
              <IndicatorRow label="MACD" value={data.macd} threshold={{ buy: 0, sell: 0 }} />
              <IndicatorRow label="MACD Signal" value={data.macdSignal} />
              <IndicatorRow
                label="MACD Histogram"
                value={data.macdHistogram}
                threshold={{ buy: 0, sell: 0 }}
              />
              <IndicatorRow label="BB Lower" value={data.bbLower} />
              <IndicatorRow label="BB Upper" value={data.bbUpper} />
              <IndicatorRow label="Donchian Lower" value={data.donchLower} />
              <IndicatorRow label="Donchian Upper" value={data.donchUpper} />
              <IndicatorRow label="SMA 20" value={data.sma20} />
              <IndicatorRow label="EMA 20" value={data.ema20} />
              {data.sma50 !== undefined && <IndicatorRow label="SMA 50" value={data.sma50} />}
              {data.sma200 !== undefined && <IndicatorRow label="SMA 200" value={data.sma200} />}
              {data.volumeRatio !== undefined && (
                <IndicatorRow
                  label="Volume Ratio"
                  value={data.volumeRatio}
                  threshold={{ buy: 1.5, sell: 0.5 }}
                />
              )}
              <IndicatorRow label="ATR" value={data.atr} />
            </tbody>
          </table>
        </Section>

        {/* Right column: Score + Risk + Probabilities */}
        <div className="space-y-4">
          {/* Score */}
          <Section title="COMPOSITE SCORE">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground w-20">SCORE</span>
                <ScoreBar value={data.score} />
              </div>
              <div className="text-xs font-mono text-muted-foreground">
                THRESHOLD: <span className="text-foreground">BUY &gt;200 / SELL &lt;130</span>
              </div>
            </div>
          </Section>

          {/* Risk */}
          <Section title="RISK MANAGEMENT">
            <table className="w-full" aria-label="Risk management levels">
              <tbody>
                <IndicatorRow label="Stop Loss" value={data.stopLoss} />
                <IndicatorRow label="Take Profit" value={data.takeProfit} />
                <IndicatorRow label="Trailing Stop" value={data.trailingStop} />
                <IndicatorRow label="Trailing Start" value={data.trailingStart} />
              </tbody>
            </table>
          </Section>
        </div>
      </div>

      {/* Patterns */}
      <Section title="CHART PATTERNS">
        <PatternList patterns={data.patterns} />
      </Section>
    </div>
  );
}
