'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { TickerResult } from '@/lib/api';
import { squarify, type TreemapTile } from '@/lib/treemap';
import { formatMarketCap } from '@/lib/utils';

interface MarketHeatmapProps {
  results: TickerResult[];
}

/**
 * Virtual layout space for the squarified treemap. Tiles are positioned with
 * percentages, so this only fixes the aspect ratio the layout optimizes for
 * (roughly the rendered container's md aspect).
 */
const LAYOUT_W = 1000;
const LAYOUT_H = 520;
/** Sector label strip height in virtual units. */
const LABEL_H = 26;

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
  return '';
}

function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

interface SectorRegion {
  sector: string;
  rect: TreemapTile<string>['rect'];
  tiles: Array<TreemapTile<TickerResult>>;
}

export function MarketHeatmap({ results }: MarketHeatmapProps) {
  const regions = useMemo<SectorRegion[]>(() => {
    const groups = new Map<string, TickerResult[]>();
    for (const r of results) {
      const sector = r.sector ?? 'Unknown';
      const group = groups.get(sector) ?? [];
      group.push(r);
      groups.set(sector, group);
    }

    // Null market caps still deserve a visible tile: weight them at the
    // smallest known cap (or $1B when nothing has a cap).
    const knownCaps = results.map((r) => r.marketCap ?? 0).filter((c) => c > 0);
    const fallbackCap = knownCaps.length > 0 ? Math.min(...knownCaps) : 1e9;
    const weight = (r: TickerResult) =>
      r.marketCap && r.marketCap > 0 ? r.marketCap : fallbackCap;

    const sectorItems = [...groups.entries()].map(([sector, rows]) => ({
      value: rows.reduce((sum, r) => sum + weight(r), 0),
      data: { sector, rows },
    }));

    const outer = squarify(sectorItems, { x: 0, y: 0, w: LAYOUT_W, h: LAYOUT_H });

    return outer.map(({ rect, data }) => {
      const inner = {
        x: rect.x,
        y: rect.y + LABEL_H,
        w: rect.w,
        h: Math.max(rect.h - LABEL_H, 1),
      };
      return {
        sector: data.sector,
        rect,
        tiles: squarify(
          data.rows.map((r) => ({ value: weight(r), data: r })),
          inner
        ),
      };
    });
  }, [results]);

  if (results.length === 0) return null;

  return (
    <section aria-label="Sector treemap of screener tickers, tile size by market cap">
      <div className="relative w-full h-[420px] sm:h-[480px] md:h-[520px] overflow-hidden">
        {regions.map(({ sector, rect, tiles }) => (
          <div
            key={sector}
            className="absolute"
            style={{
              left: pct(rect.x, LAYOUT_W),
              top: pct(rect.y, LAYOUT_H),
              width: pct(rect.w, LAYOUT_W),
              height: pct(rect.h, LAYOUT_H),
            }}
          >
            <div
              className="truncate px-1 font-mono text-[9px] leading-none tracking-widest text-muted-foreground"
              style={{ height: pct(LABEL_H, rect.h), paddingTop: 6 }}
            >
              {sector.toUpperCase()}
            </div>
          </div>
        ))}
        {regions.flatMap(({ sector, tiles }) =>
          tiles.map(({ rect, data: r }) => {
            const change = r.dayChangePct;
            const changeLabel =
              change != null ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—';
            // Hide text that cannot fit instead of overflowing neighbours.
            const showTicker = rect.w >= 36 && rect.h >= 18;
            const showChange = rect.w >= 52 && rect.h >= 34;
            return (
              <Tooltip key={r.ticker}>
                <TooltipTrigger
                  render={(props) => (
                    <Link
                      {...props}
                      href={`/${r.ticker}`}
                      className={`absolute flex flex-col items-center justify-center overflow-hidden font-mono outline outline-1 -outline-offset-1 outline-background/60 transition-opacity hover:opacity-80 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary ${signalBorder(r.opinion)}`}
                      style={{
                        left: pct(rect.x, LAYOUT_W),
                        top: pct(rect.y, LAYOUT_H),
                        width: pct(rect.w, LAYOUT_W),
                        height: pct(rect.h, LAYOUT_H),
                        background: tileBackground(change),
                      }}
                      aria-label={`${r.ticker}${r.name ? ` ${r.name}` : ''}, ${
                        change != null ? `${change.toFixed(2)}%` : 'no change data'
                      }, market cap ${formatMarketCap(r.marketCap)}, sector ${sector}, signal ${r.opinion}`}
                    >
                      {showTicker && (
                        <span className="max-w-full truncate px-0.5 text-[11px] font-bold leading-tight text-foreground">
                          {r.ticker}
                        </span>
                      )}
                      {showChange && (
                        <span className="max-w-full truncate px-0.5 text-[10px] leading-tight tabular-nums text-foreground/80">
                          {changeLabel}
                        </span>
                      )}
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
                      {changeLabel} · {r.opinion}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })
        )}
      </div>
    </section>
  );
}
