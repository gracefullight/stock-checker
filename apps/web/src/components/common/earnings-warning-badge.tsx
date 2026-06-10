import { EARNINGS_PROXIMITY_DAYS } from '@stock-checker/core/src/constants';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface EarningsWarningBadgeProps {
  daysToEarnings: number | null | undefined;
  className?: string;
}

/** True when earnings are 0..EARNINGS_PROXIMITY_DAYS trading days away. */
export function isEarningsImminent(daysToEarnings: number | null | undefined): boolean {
  return daysToEarnings != null && daysToEarnings >= 0 && daysToEarnings <= EARNINGS_PROXIMITY_DAYS;
}

/**
 * Warning chip shown next to BUY signals when earnings are imminent —
 * volatility risk the signal score does not price in.
 */
export function EarningsWarningBadge({ daysToEarnings, className }: EarningsWarningBadgeProps) {
  if (!isEarningsImminent(daysToEarnings)) return null;
  return (
    <Badge
      className={cn(
        'font-mono tracking-widest rounded-sm text-[10px] font-bold bg-warning/10 text-warning border-transparent',
        className
      )}
      aria-label={`Earnings in ${daysToEarnings} trading days`}
    >
      ⚠ E-{daysToEarnings}
    </Badge>
  );
}
