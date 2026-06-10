import type { EarningsDTO } from '@/lib/api';

interface EarningsPanelProps {
  earnings: EarningsDTO;
}

function fmtEps(v: number | null | undefined): string {
  return v != null ? `$${v.toFixed(2)}` : '—';
}

/** Bloomberg FA-style earnings panel: consensus, revisions, EPS history. */
export function EarningsPanel({ earnings }: EarningsPanelProps) {
  const est = earnings.nextEarningsEstimate;
  const rev = earnings.estimateRevisions;
  // Defensive: rows without a report date (e.g. stale cached API payloads) are unrenderable.
  const history = earnings.earningsHistory
    .filter((h) => h.reportDate != null)
    .slice(-4)
    .reverse();

  return (
    <div className="space-y-3">
      {/* Consensus estimate */}
      {est ? (
        <div className="font-mono text-xs space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] tracking-widest text-muted-foreground">CONSENSUS EPS</span>
            <span className="tabular-nums text-foreground">{fmtEps(est.avg)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] tracking-widest text-muted-foreground">RANGE</span>
            <span className="tabular-nums text-muted-foreground">
              {fmtEps(est.low)} – {fmtEps(est.high)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] tracking-widest text-muted-foreground">YEAR-AGO EPS</span>
            <span className="tabular-nums text-muted-foreground">{fmtEps(est.yearAgoEps)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] tracking-widest text-muted-foreground">ANALYSTS</span>
            <span className="tabular-nums text-muted-foreground">{est.numberOfAnalysts}</span>
          </div>
        </div>
      ) : (
        <div className="font-mono text-xs text-muted-foreground">NO CONSENSUS DATA</div>
      )}

      {/* Estimate revisions (30d) */}
      {rev && (
        <div className="flex items-baseline justify-between gap-2 font-mono text-xs border-t border-border/50 pt-2">
          <span className="text-[10px] tracking-widest text-muted-foreground">REVISIONS (30D)</span>
          <span className="tabular-nums">
            <span className="text-success">▲{rev.up30 ?? 0}</span>
            <span className="text-muted-foreground"> / </span>
            <span className="text-destructive">▼{rev.down30 ?? 0}</span>
            {rev.direction && (
              <span
                className={
                  rev.direction === 'up'
                    ? 'text-success'
                    : rev.direction === 'down'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                }
              >
                {' '}
                {rev.direction === 'up' ? '↑' : rev.direction === 'down' ? '↓' : '→'}{' '}
                {rev.direction.toUpperCase()}
              </span>
            )}
          </span>
        </div>
      )}

      {/* EPS history */}
      {history.length > 0 ? (
        <table className="w-full border-t border-border/50 pt-1" aria-label="EPS history">
          <thead>
            <tr className="font-mono text-[10px] tracking-widest text-muted-foreground">
              <th className="text-left font-normal py-1">DATE</th>
              <th className="text-right font-normal py-1">EST</th>
              <th className="text-right font-normal py-1">ACTUAL</th>
              <th className="text-right font-normal py-1">SURPRISE</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => {
              const beat = h.surprisePercent != null && h.surprisePercent >= 0;
              return (
                <tr key={h.reportDate} className="font-mono text-xs">
                  <td className="py-0.5 text-muted-foreground">{h.reportDate.slice(0, 10)}</td>
                  <td className="py-0.5 text-right tabular-nums text-muted-foreground">
                    {fmtEps(h.epsEstimate)}
                  </td>
                  <td className="py-0.5 text-right tabular-nums text-foreground">
                    {fmtEps(h.epsActual)}
                  </td>
                  <td
                    className={`py-0.5 text-right tabular-nums ${
                      h.surprisePercent == null
                        ? 'text-muted-foreground'
                        : beat
                          ? 'text-success'
                          : 'text-destructive'
                    }`}
                  >
                    {h.surprisePercent != null
                      ? `${h.surprisePercent.toFixed(1)}% ${beat ? 'BEAT' : 'MISS'}`
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="font-mono text-xs text-muted-foreground border-t border-border/50 pt-2">
          NO EARNINGS HISTORY
        </div>
      )}
    </div>
  );
}
