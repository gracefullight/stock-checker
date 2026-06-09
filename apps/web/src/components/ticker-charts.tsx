'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const CandlestickChart = dynamic(
  () => import('@/components/candlestick-chart').then((m) => m.CandlestickChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[420px] w-full rounded-none" />,
  }
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
      <Card className="rounded-none ring-0 border border-border bg-card py-0">
        <CardContent className="p-0">
          <CandlestickChart ticker={ticker} days={180} />
        </CardContent>
      </Card>

      {buyProbability !== undefined &&
        sellProbability !== undefined &&
        holdProbability !== undefined && (
          <Card className="mt-4 rounded-none ring-0 border border-border bg-card">
            <CardContent>
              <ProbabilityChart
                buyProbability={buyProbability}
                sellProbability={sellProbability}
                holdProbability={holdProbability}
              />
              {confidence !== undefined && (
                <div className="text-center font-mono text-[10px] text-muted-foreground mt-2">
                  CONFIDENCE <span className="text-foreground">{confidence}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

      <Card className="mt-4 rounded-none ring-0 border border-border bg-card">
        <CardContent>
          <div className="flex justify-around py-2">
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
        </CardContent>
      </Card>
    </>
  );
}
