import { Progress } from '@base-ui/react/progress';
import { cva } from 'class-variance-authority';
import { ProgressIndicator, ProgressTrack } from '@/components/ui/progress';
import {
  deriveSignalVisual,
  type SignalThresholds,
  type SignalTone,
  toneTextClass,
} from '@/lib/signal-visuals';
import { cn } from '@/lib/utils';

interface ScoreBarProps {
  value: number;
  /** Engine final decision; the bar colour follows it, never the raw score. */
  decision?: string | null;
  /** Separate buy score when the API provides one (score may be a blend). */
  buyScore?: number | null;
  /** Frozen thresholds (buy/sell/scoreMax) from the pipeline config. */
  thresholds?: SignalThresholds | null;
  /** Override the meter maximum; defaults to the config's scoreMax cap. */
  max?: number;
  /** Hide the text state label (keep it on when the badge is not adjacent). */
  showLabel?: boolean;
}

const scoreIndicatorVariants = cva('h-full transition-all', {
  variants: {
    tone: {
      success: 'bg-success',
      destructive: 'bg-destructive',
      warning: 'bg-warning',
      muted: 'bg-muted-foreground/60',
    } satisfies Record<SignalTone, string>,
  },
  defaultVariants: {
    tone: 'muted',
  },
});

/**
 * Composite score meter. Colour and the text label both come from the final
 * decision plus the frozen thresholds: a HOLD above the buy threshold shows
 * as BLOCKED (amber), not as a strong green BUY.
 */
export function ScoreBar({
  value,
  decision,
  buyScore,
  thresholds,
  max,
  showLabel = true,
}: ScoreBarProps) {
  const visual = deriveSignalVisual({ decision, score: value, buyScore, thresholds });
  const meterMax = max ?? visual.meterMax;
  const pct = Math.min(100, Math.max(0, (value / meterMax) * 100));

  return (
    // biome-ignore lint/a11y/useSemanticElements: role="meter" is the correct WAI-ARIA role for this custom score gauge; there is no equivalent native element with these aria-value semantics.
    <div
      className="flex items-center gap-2 min-w-[140px]"
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={meterMax}
      aria-valuetext={`${Math.round(value)} of ${meterMax}, ${visual.label}`}
      aria-label={`Score: ${Math.round(value)} of ${meterMax} (${visual.label})`}
      title={visual.description}
    >
      <Progress.Root value={pct} max={100} className="flex-1">
        <ProgressTrack>
          <ProgressIndicator
            className={cn(scoreIndicatorVariants({ tone: visual.tone }))}
            style={{ width: `${pct}%` }}
          />
        </ProgressTrack>
      </Progress.Root>
      <span className="text-xs font-mono text-muted-foreground w-10 text-right tabular-nums">
        {Math.round(value)}
      </span>
      {showLabel && (
        <span
          className={cn(
            'font-mono text-[10px] tracking-widest w-16 text-left',
            toneTextClass(visual.tone)
          )}
        >
          {visual.label}
        </span>
      )}
    </div>
  );
}
