interface ScoreBarProps {
  value: number;
  max?: number;
}

export function ScoreBar({ value, max = 600 }: ScoreBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  let fillColor: string;
  if (value > 280) {
    fillColor = 'bg-[var(--green)]';
  } else if (value < 200) {
    fillColor = 'bg-[var(--red)]';
  } else {
    fillColor = 'bg-[var(--yellow)]';
  }

  return (
    <div
      className="flex items-center gap-2 min-w-[140px]"
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={`Score: ${value} of ${max}`}
    >
      <div className="flex-1 h-2 bg-[var(--border)] rounded-sm overflow-hidden">
        <div
          className={`h-full rounded-sm transition-all ${fillColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-[var(--text-secondary)] w-10 text-right tabular-nums">
        {Math.round(value)}
      </span>
    </div>
  );
}
