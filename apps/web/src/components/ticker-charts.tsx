'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { SignalFingerprint } from '@/lib/signal-gates.types';

const CandlestickChart = dynamic(
  () => import('@/components/candlestick-chart').then((m) => m.CandlestickChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[420px] w-full rounded-none" />,
  }
);

const ScoreMixChart = dynamic(
  () => import('@/components/score-mix-chart').then((m) => m.ScoreMixChart),
  { ssr: false }
);

const IndicatorGauge = dynamic(
  () => import('@/components/indicator-gauge').then((m) => m.IndicatorGauge),
  { ssr: false }
);

interface Props {
  ticker: string;
  decision: string;
  buyWeight?: number;
  sellWeight?: number;
  holdWeight?: number;
  rsi: number;
  stochasticK: number;
  events?: Array<{ date: string; kind: 'earnings' | 'exDividend' }>;
  /** Active strategy fingerprint used to separate current and legacy chart markers. */
  currentConfig?: SignalFingerprint;
}

export function TickerCharts({
  ticker,
  decision,
  buyWeight,
  sellWeight,
  holdWeight,
  rsi,
  stochasticK,
  events,
  currentConfig,
}: Props) {
  return (
    <>
      <Card className="rounded-none ring-0 border border-border bg-card py-0">
        <CardContent className="p-0">
          {/* key forces a fresh instance per ticker so the chart's data cache
              never bleeds a previous symbol's candles into a new one. */}
          <CandlestickChart
            key={ticker}
            ticker={ticker}
            days={180}
            events={events}
            currentConfig={currentConfig}
          />
        </CardContent>
      </Card>

      {buyWeight !== undefined && sellWeight !== undefined && holdWeight !== undefined && (
        <Card className="mt-4 rounded-none ring-0 border border-border bg-card">
          <CardContent>
            <ScoreMixChart
              decision={decision}
              buyWeight={buyWeight}
              sellWeight={sellWeight}
              holdWeight={holdWeight}
            />
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
