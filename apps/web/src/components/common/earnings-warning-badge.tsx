import { EARNINGS_PROXIMITY_DAYS } from '@stock-checker/core/src/constants';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { VALIDATED_STRATEGY } from '@/lib/validated-strategy.constants';

interface EarningsWarningBadgeProps {
  daysToEarnings: number | null | undefined;
  nextEarningsDate?: string | null;
  className?: string;
}

/** True when earnings are 0..EARNINGS_PROXIMITY_DAYS trading days away. */
export function isEarningsImminent(daysToEarnings: number | null | undefined): boolean {
  return daysToEarnings != null && daysToEarnings >= 0 && daysToEarnings <= EARNINGS_PROXIMITY_DAYS;
}

/**
 * True when the report lands inside the validated hold: entry at the next
 * session open, exit at the fifth session close, so any earnings date within
 * the next five trading days is inside the position.
 */
export function isEarningsInsideHold(daysToEarnings: number | null | undefined): boolean {
  return (
    daysToEarnings != null &&
    daysToEarnings >= 0 &&
    daysToEarnings <= VALIDATED_STRATEGY.holdSessions
  );
}

/**
 * Warning chip shown next to BUY signals when earnings fall inside the
 * five-session hold window — event risk the signal score does not price in.
 */
export function EarningsWarningBadge({
  daysToEarnings,
  nextEarningsDate,
  className,
}: EarningsWarningBadgeProps) {
  if (!isEarningsInsideHold(daysToEarnings)) return null;
  const when = nextEarningsDate ? ` (${nextEarningsDate.slice(0, 10)})` : '';
  return (
    <Badge
      className={cn(
        'font-mono tracking-widest rounded-sm text-[10px] font-bold bg-warning/10 text-warning border-transparent',
        className
      )}
      aria-label={`Earnings in ${daysToEarnings} trading days${when}, inside the ${VALIDATED_STRATEGY.holdSessions}-session hold`}
      title={`실적 발표가 ${VALIDATED_STRATEGY.holdSessions}세션 보유 구간 안에 있습니다${when}`}
    >
      ⚠ 실적 D-{daysToEarnings} · 보유구간 내
    </Badge>
  );
}
