import { isEarningsImminent } from '@/components/common/earnings-warning-badge';

interface UpcomingEventsCardProps {
  nextEarningsDate: string | null;
  daysToEarnings: number | null;
  exDividendDate: string | null;
  dividendDate: string | null;
}

function EventRow({
  label,
  date,
  suffix,
  warn,
}: {
  label: string;
  date: string;
  suffix?: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 border-b border-border/50 last:border-b-0">
      <span className="font-mono text-[10px] tracking-widest text-muted-foreground">{label}</span>
      <span
        className={`font-mono text-xs tabular-nums ${warn ? 'text-warning' : 'text-foreground'}`}
      >
        {date}
        {suffix && <span className="text-muted-foreground"> {suffix}</span>}
      </span>
    </div>
  );
}

export function UpcomingEventsCard({
  nextEarningsDate,
  daysToEarnings,
  exDividendDate,
  dividendDate,
}: UpcomingEventsCardProps) {
  if (!nextEarningsDate && !exDividendDate && !dividendDate) {
    return <div className="font-mono text-xs text-muted-foreground">NO SCHEDULED EVENTS</div>;
  }
  return (
    <section aria-label="Upcoming corporate events">
      {nextEarningsDate && (
        <EventRow
          label="EARNINGS"
          date={nextEarningsDate}
          suffix={
            daysToEarnings != null && daysToEarnings >= 0 ? `(T-${daysToEarnings})` : undefined
          }
          warn={isEarningsImminent(daysToEarnings)}
        />
      )}
      {exDividendDate && <EventRow label="EX-DIVIDEND" date={exDividendDate.slice(0, 10)} />}
      {dividendDate && <EventRow label="DIV PAYMENT" date={dividendDate.slice(0, 10)} />}
    </section>
  );
}
