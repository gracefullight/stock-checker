'use client';

import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts';

interface Props {
  label: string;
  value: number;
  min?: number;
  max?: number;
  oversoldThreshold?: number;
  overboughtThreshold?: number;
}

function valueColor(
  value: number,
  oversold: number,
  overbought: number
): string {
  if (value <= oversold) return '#00ff88';
  if (value >= overbought) return '#ff3333';
  return '#888888';
}

export function IndicatorGauge({
  label,
  value,
  min = 0,
  max = 100,
  oversoldThreshold = 30,
  overboughtThreshold = 70,
}: Props) {
  const pct = Math.round(((value - min) / (max - min)) * 100);
  const color = valueColor(value, oversoldThreshold, overboughtThreshold);

  const data = [{ name: label, value: pct, fill: color }];

  let zone = 'NEUTRAL';
  if (value <= oversoldThreshold) zone = 'OVERSOLD';
  if (value >= overboughtThreshold) zone = 'OVERBOUGHT';

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-[120px] h-[70px]">
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
            background={{ fill: '#1f1f1f' }}
            dataKey="value"
            angleAxisId={0}
            cornerRadius={2}
          />
        </RadialBarChart>

        {/* value label at centre */}
        <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center">
          <span className="font-mono text-base font-bold" style={{ color }}>
            {value.toFixed(1)}
          </span>
        </div>
      </div>

      <span className="font-mono text-[10px] text-[var(--text-secondary)] tracking-widest">
        {label}
      </span>
      <span className="font-mono text-[9px] tracking-wider" style={{ color }}>
        {zone}
      </span>
    </div>
  );
}
