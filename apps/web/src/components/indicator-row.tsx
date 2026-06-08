interface IndicatorRowProps {
  label: string;
  value: number | string;
  threshold?: {
    buy?: number;
    sell?: number;
  };
}

function getValueColor(value: number | string, threshold?: IndicatorRowProps['threshold']): string {
  if (typeof value !== 'number' || !threshold) {
    return 'text-[var(--text-primary)]';
  }
  if (threshold.buy !== undefined && value >= threshold.buy) {
    return 'text-[var(--green)]';
  }
  if (threshold.sell !== undefined && value <= threshold.sell) {
    return 'text-[var(--red)]';
  }
  return 'text-[var(--yellow)]';
}

function formatValue(value: number | string): string {
  if (typeof value === 'number') {
    return value.toFixed(2);
  }
  return value;
}

export function IndicatorRow({ label, value, threshold }: IndicatorRowProps) {
  const colorClass = getValueColor(value, threshold);
  return (
    <tr className="border-b border-[var(--border)] hover:bg-[var(--surface)]">
      <td className="py-1 px-2 text-xs text-[var(--text-secondary)] font-mono whitespace-nowrap">
        {label}
      </td>
      <td className={`py-1 px-2 text-xs font-mono text-right tabular-nums ${colorClass}`}>
        {formatValue(value)}
      </td>
    </tr>
  );
}
