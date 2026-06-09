import { cva } from 'class-variance-authority';

import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

interface IndicatorRowProps {
  label: string;
  value: number | string;
  threshold?: {
    buy?: number;
    sell?: number;
  };
}

const valueColorVariants = cva('py-1 px-2 text-xs font-mono text-right tabular-nums', {
  variants: {
    color: {
      success: 'text-success',
      destructive: 'text-destructive',
      warning: 'text-warning',
      default: 'text-foreground',
    },
  },
  defaultVariants: {
    color: 'default',
  },
});

function getValueColor(
  value: number | string,
  threshold?: IndicatorRowProps['threshold']
): 'success' | 'destructive' | 'warning' | 'default' {
  if (typeof value !== 'number' || !threshold) {
    return 'default';
  }
  if (threshold.buy !== undefined && value >= threshold.buy) {
    return 'success';
  }
  if (threshold.sell !== undefined && value <= threshold.sell) {
    return 'destructive';
  }
  return 'warning';
}

function formatValue(value: number | string): string {
  if (typeof value === 'number') {
    return value.toFixed(2);
  }
  return value;
}

export function IndicatorRow({ label, value, threshold }: IndicatorRowProps) {
  const color = getValueColor(value, threshold);
  return (
    <TableRow>
      <TableCell className="py-1 px-2 text-xs text-muted-foreground font-mono whitespace-nowrap">
        {label}
      </TableCell>
      <TableCell className={cn(valueColorVariants({ color }))}>{formatValue(value)}</TableCell>
    </TableRow>
  );
}
