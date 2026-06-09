'use client';

import { Cell, Pie, PieChart } from 'recharts';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

interface Props {
  buyProbability: number;
  sellProbability: number;
  holdProbability: number;
}

const CHART_CONFIG = {
  BUY: {
    label: 'BUY',
    color: 'var(--success)',
  },
  SELL: {
    label: 'SELL',
    color: 'var(--destructive)',
  },
  HOLD: {
    label: 'HOLD',
    color: 'var(--muted-foreground)',
  },
} satisfies ChartConfig;

const SLICE_KEYS = ['BUY', 'SELL', 'HOLD'] as const;
type SliceKey = (typeof SLICE_KEYS)[number];

function getSliceColorVar(key: SliceKey): string {
  return `var(--color-${key})`;
}

export function ProbabilityChart({ buyProbability, sellProbability, holdProbability }: Props) {
  const data: Array<{ name: SliceKey; value: number }> = [
    { name: 'BUY', value: Math.round(buyProbability) },
    { name: 'SELL', value: Math.round(sellProbability) },
    { name: 'HOLD', value: Math.round(holdProbability) },
  ];

  const dominant = data.reduce((a, b) => (a.value >= b.value ? a : b));
  const dominantColorVar = getSliceColorVar(dominant.name);

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative w-full h-[160px]"
        role="img"
        aria-label={`Signal probability: BUY ${data[0].value}%, SELL ${data[1].value}%, HOLD ${data[2].value}%. Dominant ${dominant.name} at ${dominant.value}%.`}
      >
        <ChartContainer
          config={CHART_CONFIG}
          className="w-full h-[160px]"
          initialDimension={{ width: 200, height: 160 }}
        >
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={72}
              dataKey="value"
              strokeWidth={0}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={getSliceColorVar(entry.name)}
                  opacity={entry.name === dominant.name ? 1 : 0.35}
                />
              ))}
            </Pie>
            <ChartTooltip
              content={
                <ChartTooltipContent formatter={(value) => [`${Number(value)}%`, '']} hideLabel />
              }
            />
          </PieChart>
        </ChartContainer>

        {/* centre label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="font-mono text-lg font-bold" style={{ color: dominantColorVar }}>
            {dominant.value}%
          </span>
          <span
            className="font-mono text-[10px] tracking-widest"
            style={{ color: dominantColorVar }}
          >
            {dominant.name}
          </span>
        </div>
      </div>

      {/* legend */}
      <div className="flex gap-4">
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: getSliceColorVar(entry.name) }}
            />
            <span className="font-mono text-[10px] text-muted-foreground">
              {entry.name} {entry.value}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
