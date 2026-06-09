'use client';

import dynamic from 'next/dynamic';

const CandlestickChart = dynamic(
  () => import('@/components/candlestick-chart').then((m) => m.CandlestickChart),
  { ssr: false, loading: () => <div className="h-[420px] bg-[var(--surface)] animate-pulse" /> }
);

const ProbabilityChart = dynamic(
  () => import('@/components/probability-chart').then((m) => m.ProbabilityChart),
  { ssr: false }
);

const IndicatorGauge = dynamic(
  () => import('@/components/indicator-gauge').then((m) => m.IndicatorGauge),
  { ssr: false }
);

interface Props {
  ticker: string;
  buyProbability?: number;
  sellProbability?: number;
  holdProbability?: number;
  confidence?: string;
  rsi: number;
  stochasticK: number;
}

export function TickerCharts({
  ticker,
  buyProbability,
  sellProbability,
  holdProbability,
  confidence,
  rsi,
  stochasticK,
}: Props) {
  return (
    <>
      <CandlestickChart ticker={ticker} days={180} />

      {buyProbability !== undefined &&
        sellProbability !== undefined &&
        holdProbability !== undefined && (
          <div className="mt-4 space-y-4">
            <ProbabilityChart
              buyProbability={buyProbability}
              sellProbability={sellProbability}
              holdProbability={holdProbability}
            />
            {confidence !== undefined && (
              <div className="text-center font-mono text-[10px] text-[var(--text-secondary)]">
                CONFIDENCE{' '}
                <span className="text-[var(--text-primary)]">{confidence}</span>
              </div>
            )}
          </div>
        )}

      <div className="mt-4 flex justify-around py-2">
        <IndicatorGauge
          label="RSI"
          value={rsi}
          oversoldThreshold={30}
          overboughtThreshold={70}
        />
        <IndicatorGauge
          label="STOCH K"
          value={stochasticK}
          oversoldThreshold={20}
          overboughtThreshold={80}
        />
      </div>
    </>
  );
}
