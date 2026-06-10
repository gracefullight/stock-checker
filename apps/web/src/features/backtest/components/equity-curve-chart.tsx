'use client';

import { Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import type { EquityPointDTO } from '@/features/backtest/types/protocol';

interface EquityCurveChartProps {
  points: EquityPointDTO[];
}

const CHART_CONFIG = {
  equity: {
    label: 'EQUITY',
    color: 'var(--primary)',
  },
} satisfies ChartConfig;

export function EquityCurveChart({ points }: EquityCurveChartProps) {
  if (points.length < 2) {
    return (
      <div className="h-[200px] flex items-center justify-center font-mono text-xs text-muted-foreground">
        NOT ENOUGH TRADES FOR AN EQUITY CURVE
      </div>
    );
  }

  return (
    <ChartContainer
      config={CHART_CONFIG}
      className="w-full h-[200px]"
      initialDimension={{ width: 600, height: 200 }}
    >
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
          tickLine={false}
          minTickGap={48}
        />
        <YAxis
          tick={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
          tickLine={false}
          width={56}
          domain={['auto', 'auto']}
          tickFormatter={(v: number) => `$${Math.round(v).toLocaleString()}`}
        />
        <Line
          type="stepAfter"
          dataKey="equity"
          stroke="var(--color-equity)"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => [`$${Number(value).toFixed(0)}`, 'EQUITY']}
            />
          }
        />
      </LineChart>
    </ChartContainer>
  );
}
