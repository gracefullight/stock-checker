import Link from 'next/link';
import { IndicatorRow } from '@/components/indicator-row';
import { PatternList } from '@/components/pattern-list';
import { ScoreBar } from '@/components/score-bar';
import { SignalBadge } from '@/components/signal-badge';
import { getTickerDetail } from '@/lib/api';

interface PageProps {
  params: Promise<{ ticker: string }>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="border border-[var(--border)] bg-[var(--surface)]"
      aria-labelledby={`section-${title.replace(/\s+/g, '-').toLowerCase()}`}
    >
      <div className="px-3 py-1.5 border-b border-[var(--border)] bg-[#0f0f0f]">
        <h2
          id={`section-${title.replace(/\s+/g, '-').toLowerCase()}`}
          className="text-[10px] font-mono font-bold tracking-widest text-[var(--cyan)]"
        >
          {title}
        </h2>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

export default async function TickerDetailPage({ params }: PageProps) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();

  let data;
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
          <Link
            href="/"
            className="text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--cyan)]"
          >
            &lt; BACK TO SCREENER
          </Link>
        </div>
        <div
          className="p-4 border border-[var(--red)] bg-[var(--surface)] font-mono text-xs text-[var(--red)]"
          role="alert"
        >
          ERROR [{symbol}]: {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="font-mono text-xs text-[var(--text-secondary)]" aria-live="polite">
        LOADING...
      </div>
    );
  }

  const signal = data.opinion as 'BUY' | 'SELL' | 'HOLD';

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div>
        <Link
          href="/"
          className="text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--cyan)]"
        >
          &lt; BACK TO SCREENER
        </Link>
      </div>

      {/* Header */}
      <div className="border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-3xl font-bold font-mono text-[var(--text-primary)] tracking-widest">
            {symbol}
          </h1>
          <SignalBadge signal={signal} />
          <span className="text-2xl font-mono font-bold tabular-nums text-[var(--yellow)]">
            ${data.close.toFixed(2)}
          </span>
          <span className="text-xs font-mono text-[var(--text-secondary)] ml-auto">
            {data.date}
          </span>
        </div>
        {data.trendRegime && (
          <div className="mt-2 text-xs font-mono text-[var(--text-secondary)]">
            REGIME:{' '}
            <span className="text-[var(--text-primary)]">{data.trendRegime.toUpperCase()}</span>
          </div>
        )}
      </div>

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
                <span className="text-xs font-mono text-[var(--text-secondary)] w-20">SCORE</span>
                <ScoreBar value={data.score} />
              </div>
              <div className="text-xs font-mono text-[var(--text-secondary)]">
                THRESHOLD:{' '}
                <span className="text-[var(--text-primary)]">BUY &gt;370 / SELL &lt;200</span>
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

          {/* Probabilities */}
          {(data.buyProbability !== undefined || data.sellProbability !== undefined) && (
            <Section title="SIGNAL PROBABILITIES">
              <table className="w-full" aria-label="Signal probabilities">
                <tbody>
                  {data.buyProbability !== undefined && (
                    <IndicatorRow
                      label="Buy %"
                      value={`${(data.buyProbability * 100).toFixed(1)}%`}
                    />
                  )}
                  {data.sellProbability !== undefined && (
                    <IndicatorRow
                      label="Sell %"
                      value={`${(data.sellProbability * 100).toFixed(1)}%`}
                    />
                  )}
                  {data.holdProbability !== undefined && (
                    <IndicatorRow
                      label="Hold %"
                      value={`${(data.holdProbability * 100).toFixed(1)}%`}
                    />
                  )}
                  {data.confidence !== undefined && (
                    <IndicatorRow label="Confidence" value={data.confidence} />
                  )}
                </tbody>
              </table>
            </Section>
          )}
        </div>
      </div>

      {/* Patterns */}
      <Section title="CHART PATTERNS">
        <PatternList patterns={data.patterns} />
      </Section>
    </div>
  );
}
