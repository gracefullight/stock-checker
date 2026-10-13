import { TableCell, TableRow } from '@/components/ui/table';
import {
  type IndicatorZone,
  indicatorZone,
  ZONE_LABEL,
  ZONE_SHORT_LABEL,
  type ZoneBounds,
  zoneTextClass,
} from '@/lib/indicator-zones';
import { cn } from '@/lib/utils';

interface IndicatorRowProps {
  label: string;
  value: number | string;
  /** Oversold/overbought bounds; extremes render amber with a text label. */
  zone?: ZoneBounds;
  /** Free-text note shown after the value (e.g. HIGH VOLUME). */
  note?: string;
}

function formatValue(value: number | string): string {
  if (typeof value === 'number') {
    return value.toFixed(2);
  }
  return value;
}

export function IndicatorRow({ label, value, zone, note }: IndicatorRowProps) {
  const zoneKey: IndicatorZone =
    typeof value === 'number' && zone ? indicatorZone(value, zone) : 'neutral';
  return (
    <TableRow>
      <TableCell className="py-1 px-2 text-xs text-muted-foreground font-mono whitespace-nowrap">
        {label}
      </TableCell>
      <TableCell
        className={cn(
          'py-1 px-2 text-xs font-mono text-right tabular-nums',
          zoneTextClass(zoneKey)
        )}
      >
        {formatValue(value)}
        {zoneKey !== 'neutral' && (
          <abbr
            title={ZONE_LABEL[zoneKey]}
            className="ml-1 text-[10px] tracking-widest no-underline"
            aria-label={ZONE_LABEL[zoneKey]}
          >
            {ZONE_SHORT_LABEL[zoneKey]}
          </abbr>
        )}
        {note && <span className="ml-1 text-[10px] tracking-widest text-warning">{note}</span>}
      </TableCell>
    </TableRow>
  );
}
