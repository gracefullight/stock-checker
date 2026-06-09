'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

interface Props {
  buyProbability: number;
  sellProbability: number;
  holdProbability: number;
}

const SLICES = [
  { key: 'BUY', color: '#00ff88' },
  { key: 'SELL', color: '#ff3333' },
  { key: 'HOLD', color: '#444444' },
] as const;

export function ProbabilityChart({ buyProbability, sellProbability, holdProbability }: Props) {
  const data = [
    { name: 'BUY', value: Math.round(buyProbability) },
    { name: 'SELL', value: Math.round(sellProbability) },
    { name: 'HOLD', value: Math.round(holdProbability) },
  ];

  const dominant = data.reduce((a, b) => (a.value >= b.value ? a : b));
  const dominantColor = SLICES.find((s) => s.key === dominant.name)?.color ?? '#666';

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-full h-[160px]">
        <ResponsiveContainer width="100%" height="100%">
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
                  fill={SLICES.find((s) => s.key === entry.name)?.color ?? '#666'}
                  opacity={entry.name === dominant.name ? 1 : 0.35}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: '#111',
                border: '1px solid #1f1f1f',
                borderRadius: 0,
                fontFamily: 'monospace',
                fontSize: 11,
              }}
              formatter={(value) => [`${Number(value)}%`, '']}
              itemStyle={{ color: '#e8e8e8' }}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* centre label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="font-mono text-lg font-bold" style={{ color: dominantColor }}>
            {dominant.value}%
          </span>
          <span className="font-mono text-[10px] tracking-widest" style={{ color: dominantColor }}>
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
              style={{ background: SLICES.find((s) => s.key === entry.name)?.color }}
            />
            <span className="font-mono text-[10px] text-[var(--text-secondary)]">
              {entry.name} {entry.value}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
