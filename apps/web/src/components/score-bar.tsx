import { Progress } from '@base-ui/react/progress';
import { cva } from 'class-variance-authority';
import { ProgressIndicator, ProgressTrack } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface ScoreBarProps {
  value: number;
  max?: number;
}

const scoreIndicatorVariants = cva('h-full transition-all', {
  variants: {
    threshold: {
      success: 'bg-success',
      destructive: 'bg-destructive',
      warning: 'bg-warning',
    },
  },
  defaultVariants: {
    threshold: 'warning',
  },
});

function getThreshold(value: number): 'success' | 'destructive' | 'warning' {
  if (value > 280) return 'success';
  if (value < 200) return 'destructive';
  return 'warning';
}

export function ScoreBar({ value, max = 600 }: ScoreBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const threshold = getThreshold(value);

  return (
    // biome-ignore lint/a11y/useSemanticElements: role="meter" is the correct WAI-ARIA role for this custom score gauge; there is no equivalent native element with these aria-value semantics.
    <div
      className="flex items-center gap-2 min-w-[140px]"
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={`Score: ${value} of ${max}`}
    >
      <Progress.Root value={pct} max={100} className="flex-1">
        <ProgressTrack>
          <ProgressIndicator
            className={cn(scoreIndicatorVariants({ threshold }))}
            style={{ width: `${pct}%` }}
          />
        </ProgressTrack>
      </Progress.Root>
      <span className="text-xs font-mono text-muted-foreground w-10 text-right tabular-nums">
        {Math.round(value)}
      </span>
    </div>
  );
}
