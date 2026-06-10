'use client';

import type { PipelineConfig } from '@stock-checker/core/src/types';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { PlaygroundParams } from '@/features/backtest/utils/config';

interface BacktestControlsProps {
  value: PlaygroundParams;
  onChange: (value: PlaygroundParams) => void;
  disabled?: boolean;
}

function SliderRow({
  id,
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id} className="font-mono text-[10px] tracking-widest text-muted-foreground">
          {label}
        </Label>
        <span className="font-mono text-xs tabular-nums text-foreground">{display ?? value}</span>
      </div>
      <Slider
        id={id}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
        aria-label={label}
      />
    </div>
  );
}

export function BacktestControls({ value, onChange, disabled }: BacktestControlsProps) {
  const set = <K extends keyof PlaygroundParams>(key: K, v: PlaygroundParams[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
      <div className="space-y-1">
        <Label
          htmlFor="bt-strategy"
          className="font-mono text-[10px] tracking-widest text-muted-foreground"
        >
          STRATEGY
        </Label>
        <Select
          value={value.strategy}
          onValueChange={(v) => set('strategy', v as PipelineConfig['strategy'])}
          disabled={disabled}
        >
          <SelectTrigger id="bt-strategy" className="w-full font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="institutional" className="font-mono text-xs">
              INSTITUTIONAL (flow)
            </SelectItem>
            <SelectItem value="momentum" className="font-mono text-xs">
              MOMENTUM
            </SelectItem>
            <SelectItem value="mean-reversion" className="font-mono text-xs">
              MEAN-REVERSION
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-2 pt-4">
        <Label
          htmlFor="bt-quality-gate"
          className="font-mono text-[10px] tracking-widest text-muted-foreground"
        >
          QUALITY GATE (leader pullback)
        </Label>
        <Switch
          id="bt-quality-gate"
          checked={value.qualityGateEnabled}
          onCheckedChange={(checked) => set('qualityGateEnabled', checked)}
          disabled={disabled}
        />
      </div>

      <SliderRow
        id="bt-buy"
        label="BUY THRESHOLD"
        value={value.buyThreshold}
        min={150}
        max={400}
        step={5}
        onChange={(v) => set('buyThreshold', v)}
        disabled={disabled}
      />
      <SliderRow
        id="bt-sell"
        label="SELL THRESHOLD"
        value={value.sellThreshold}
        min={100}
        max={300}
        step={5}
        onChange={(v) => set('sellThreshold', v)}
        disabled={disabled}
      />
      <SliderRow
        id="bt-gap"
        label="CLUSTER MIN GAP (days)"
        value={value.minGapDays}
        min={0}
        max={15}
        step={1}
        onChange={(v) => set('minGapDays', v)}
        disabled={disabled}
      />
      <SliderRow
        id="bt-confluence"
        label="CONFLUENCE MIN ACTIVE"
        value={value.confluenceMinActive}
        min={1}
        max={6}
        step={1}
        onChange={(v) => set('confluenceMinActive', v)}
        disabled={disabled}
      />
      <SliderRow
        id="bt-ibs"
        label="QUALITY IBS MAX"
        value={value.ibsMax}
        min={0.1}
        max={0.6}
        step={0.05}
        display={value.ibsMax.toFixed(2)}
        onChange={(v) => set('ibsMax', v)}
        disabled={disabled || !value.qualityGateEnabled}
      />
      <SliderRow
        id="bt-rs"
        label="QUALITY RS MIN"
        value={value.rsMin}
        min={0}
        max={0.9}
        step={0.05}
        display={value.rsMin.toFixed(2)}
        onChange={(v) => set('rsMin', v)}
        disabled={disabled || !value.qualityGateEnabled}
      />
    </div>
  );
}
