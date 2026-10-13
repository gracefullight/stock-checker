'use client';

import { Cell, Pie, PieChart } from 'recharts';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { normalizeDecision } from '@/lib/signal-visuals';

interface Props {
  /** Engine final decision; the mix is hidden for HOLD so it cannot read as a 79% buy. */
  decision: string | null | undefined;
  buyWeight: number;
  sellWeight: number;
  holdWeight: number;
}

const CHART_CONFIG = {
  BUY: {
    label: 'BUY weight',
    color: 'var(--success)',
  },
  SELL: {
    label: 'SELL weight',
    color: 'var(--destructive)',
  },
  HOLD: {
    label: 'HOLD weight',
    color: 'var(--muted-foreground)',
  },
} satisfies ChartConfig;

const SLICE_KEYS = ['BUY', 'SELL', 'HOLD'] as const;
type SliceKey = (typeof SLICE_KEYS)[number];

function getSliceColorVar(key: SliceKey): string {
  return `var(--color-${key})`;
}

/**
 * Score mix: how the buy/sell/hold score weights split for the final decision.
 * These are calibration weights, not win probabilities, so the chart is only
 * shown for BUY and SELL and the centre label names the *decision*, not the
 * largest slice.
 */
export function ScoreMixChart({ decision, buyWeight, sellWeight, holdWeight }: Props) {
  const final = normalizeDecision(decision);
  if (final === 'HOLD') {
    return (
      <p className="text-center font-mono text-[10px] text-muted-foreground">
        SCORE MIX hidden for HOLD: 가중치 분포는 승률이 아니며, 차단된 셋업을 강한 매수처럼 보이게
        할 수 있어 BUY/SELL에서만 표시합니다.
      </p>
    );
  }
  const data: Array<{ name: SliceKey; value: number }> = [
    { name: 'BUY', value: Math.round(buyWeight) },
    { name: 'SELL', value: Math.round(sellWeight) },
    { name: 'HOLD', value: Math.round(holdWeight) },
  ];
  const decisionColorVar = getSliceColorVar(final);
  const decisionWeight = data.find((entry) => entry.name === final)?.value ?? 0;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative w-full h-[160px]"
        role="img"
        aria-label={`Score mix for final decision ${final}: BUY ${data[0].value}%, SELL ${data[1].value}%, HOLD ${data[2].value}%. Calibration weights, not win probabilities.`}
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
                  opacity={entry.name === final ? 1 : 0.35}
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

        {/* centre label: the decision, not the dominant slice */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="font-mono text-lg font-bold" style={{ color: decisionColorVar }}>
            {final}
          </span>
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
            weight {decisionWeight}%
          </span>
        </div>
      </div>

      {/* legend: colour always paired with text */}
      <div className="flex gap-4">
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: getSliceColorVar(entry.name) }}
              aria-hidden="true"
            />
            <span className="font-mono text-[10px] text-muted-foreground">
              {entry.name} {entry.value}%
            </span>
          </div>
        ))}
      </div>
      <p className="text-center font-mono text-[10px] text-muted-foreground">
        SCORE MIX = 점수 가중치 분포. 수익 확률이나 승률이 아닙니다.
      </p>
    </div>
  );
}
