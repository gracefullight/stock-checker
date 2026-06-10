'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { TickerResult } from '@/lib/api';
import { formatMarketCap } from '@/lib/utils';

interface MarketHeatmapProps {
  results: TickerResult[];
}

/**
 * Bucketed tile color: change% mapped to a color-mix() of --success/--destructive
 * into --card at increasing intensity (±0.5 / ±1.5 / ±3 steps). DOM CSS supports
 * oklch + color-mix (unlike the lightweight-charts canvas), so tokens stay live.
 */
function tileBackground(changePct: number | null | undefined): string {
  if (changePct == null) return 'var(--muted)';
  const token = changePct >= 0 ? 'var(--success)' : 'var(--destructive)';
  const abs = Math.abs(changePct);
  const pct = abs >= 3 ? 60 : abs >= 1.5 ? 42 : abs >= 0.5 ? 26 : 12;
  return `color-mix(in oklch, ${token} ${pct}%, var(--card))`;
}

function signalBorder(opinion: string): string {
  if (opinion === 'BUY') return 'border-l-2 border-l-success';
  if (opinion === 'SELL') return 'border-l-2 border-l-destructive';
  return 'border-l-2 border-l-transparent';
}

export function MarketHeatmap({ results }: MarketHeatmapProps) {
  const sectors = useMemo(() => {
    const groups = new Map<string, TickerResult[]>();
    for (const r of results) {
      const sector = r.sector ?? 'Unknown';
      const group = groups.get(sector) ?? [];
      group.push(r);
      groups.set(sector, group);
    }
    const totalCap = (rows: TickerResult[]) => rows.reduce((s, r) => s + (r.marketCap ?? 0), 0);
    return [...groups.entries()]
      .map(([sector, rows]) => ({
        sector,
        rows: [...rows].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)),
      }))
      .sort((a, b) => totalCap(b.rows) - totalCap(a.rows));
  }, [results]);

  if (results.length === 0) return null;

  return (
    <section className="space-y-2" aria-label="Sector heatmap of screener tickers">
      {sectors.map(({ sector, rows }) => (
        <div key={sector}>
          <div className="mb-1 font-mono text-[10px] tracking-widest text-muted-foreground">
            {sector.toUpperCase()}
          </div>
          <ul className="flex flex-wrap gap-1">
            {rows.map((r) => {
              const change = r.dayChangePct;
              const grow = r.marketCap ? Math.sqrt(r.marketCap / 1e9) : 1;
              return (
                <li key={r.ticker} className="flex" style={{ flexGrow: grow, flexBasis: 0 }}>
                  <Tooltip>
                    <TooltipTrigger
                      render={(props) => (
                        <Link
                          {...props}
                          href={`/${r.ticker}`}
                          className={`flex h-14 w-full min-w-[72px] flex-col justify-center px-2 font-mono transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${signalBorder(r.opinion)}`}
                          style={{ background: tileBackground(change) }}
                          aria-label={`${r.ticker}${r.name ? ` ${r.name}` : ''}, ${
                            change != null ? `${change.toFixed(2)}%` : 'no change data'
                          }, sector ${sector}, signal ${r.opinion}`}
                        >
                          <span className="text-xs font-bold text-foreground">{r.ticker}</span>
                          <span className="text-[10px] tabular-nums text-foreground/80">
                            {change != null
                              ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`
                              : '—'}
                          </span>
                        </Link>
                      )}
                    />
                    <TooltipContent>
                      <div className="font-mono text-xs space-y-0.5">
                        <div className="font-bold">{r.name ?? r.ticker}</div>
                        <div className="text-muted-foreground">
                          {sector} · {formatMarketCap(r.marketCap)}
                        </div>
                        <div>
                          {change != null ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—'}{' '}
                          · {r.opinion}
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
