'use client';

import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts';
import { type ChartConfig, ChartContainer } from '@/components/ui/chart';

interface Props {
  label: string;
  value: number;
  min?: number;
  max?: number;
  oversoldThreshold?: number;
  overboughtThreshold?: number;
}

function getZoneKey(
  value: number,
  oversold: number,
  overbought: number
): 'oversold' | 'overbought' | 'neutral' {
  if (value <= oversold) return 'oversold';
  if (value >= overbought) return 'overbought';
  return 'neutral';
}

const CHART_CONFIG = {
  oversold: {
    label: 'Oversold',
    color: 'var(--success)',
  },
  overbought: {
    label: 'Overbought',
    color: 'var(--destructive)',
  },
  neutral: {
    label: 'Neutral',
    color: 'var(--muted-foreground)',
  },
} satisfies ChartConfig;

export function IndicatorGauge({
  label,
  value,
  min = 0,
  max = 100,
  oversoldThreshold = 30,
  overboughtThreshold = 70,
}: Props) {
  const pct = Math.round(((value - min) / (max - min)) * 100);
  const zoneKey = getZoneKey(value, oversoldThreshold, overboughtThreshold);
  const colorVar = `var(--color-${zoneKey})`;

  const ZONE_LABEL: Record<typeof zoneKey, string> = {
    oversold: 'OVERSOLD',
    overbought: 'OVERBOUGHT',
    neutral: 'NEUTRAL',
  };

  const data = [{ name: label, value: pct, fill: colorVar }];

  return (
    <div className="flex flex-col items-center gap-1">
      <ChartContainer
        config={CHART_CONFIG}
        className="w-[120px] h-[70px]"
        initialDimension={{ width: 120, height: 120 }}
      >
        <div
          className="relative w-[120px] h-[70px]"
          role="img"
          aria-label={`${label} gauge: ${value.toFixed(1)} (${ZONE_LABEL[zoneKey]})`}
        >
          <RadialBarChart
            width={120}
            height={120}
            cx={60}
            cy={100}
            innerRadius={55}
            outerRadius={85}
            startAngle={180}
            endAngle={0}
            data={data}
            barSize={10}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar
              background={{ fill: 'var(--muted)' }}
              dataKey="value"
              angleAxisId={0}
              cornerRadius={2}
            />
          </RadialBarChart>

          {/* value label at centre */}
          <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center">
            <span className="font-mono text-base font-bold" style={{ color: colorVar }}>
              {value.toFixed(1)}
            </span>
          </div>
        </div>
      </ChartContainer>

      <span className="font-mono text-[10px] text-muted-foreground tracking-widest">{label}</span>
      <span className="font-mono text-[9px] tracking-wider" style={{ color: colorVar }}>
        {ZONE_LABEL[zoneKey]}
      </span>
    </div>
  );
}
