import type { FundamentalsDTO } from '@/lib/api';
import { formatMarketCap } from '@/lib/utils';

interface FundamentalsCardProps {
  fundamentals: FundamentalsDTO;
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 border-b border-border/50 last:border-b-0">
      <dt className="font-mono text-[10px] tracking-widest text-muted-foreground">{label}</dt>
      <dd
        className={`font-mono text-xs tabular-nums ${accent ? 'text-warning' : 'text-foreground'}`}
      >
        {value}
      </dd>
    </div>
  );
}

/** Bloomberg DES-style company snapshot. */
export function FundamentalsCard({ fundamentals }: FundamentalsCardProps) {
  const f = fundamentals;
  return (
    <dl aria-label="Company fundamentals">
      <Row label="SECTOR" value={f.sector ?? '—'} />
      <Row label="MARKET CAP" value={formatMarketCap(f.marketCap)} />
      <Row label="P/E (TTM)" value={f.pe != null ? f.pe.toFixed(1) : '—'} />
      <Row
        label="DIV YIELD"
        value={f.dividendYield != null ? `${(f.dividendYield * 100).toFixed(2)}%` : '—'}
      />
      <Row label="NEXT EARNINGS" value={f.nextEarningsDate ?? '—'} accent={!!f.nextEarningsDate} />
    </dl>
  );
}
