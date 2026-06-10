'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { Tooltip as RechartsTooltip, Treemap, type TreemapNode } from 'recharts';
import type { TickerResult } from '@/lib/api';
import { formatMarketCap } from '@/lib/utils';

interface MarketHeatmapProps {
  results: TickerResult[];
}

/**
 * Bucketed tile color: change% mapped to a color-mix() of --success/--destructive
 * into --card at increasing intensity (±0.5 / ±1.5 / ±3 steps). CSS supports
 * oklch + color-mix in SVG fill via style, so theme tokens stay live.
 */
function tileBackground(changePct: number | null | undefined): string {
  if (changePct == null) return 'var(--muted)';
  const token = changePct >= 0 ? 'var(--success)' : 'var(--destructive)';
  const abs = Math.abs(changePct);
  const pct = abs >= 3 ? 60 : abs >= 1.5 ? 42 : abs >= 0.5 ? 26 : 12;
  return `color-mix(in oklch, ${token} ${pct}%, var(--card))`;
}

function formatChange(changePct: number | null | undefined): string {
  return changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—';
}

/** Leaf node payload: TreemapNode layout fields + the TickerResult spread in via data. */
type HeatmapNode = TreemapNode & Partial<TickerResult> & { sector?: string | null };

function HeatmapCell(props: Partial<HeatmapNode>) {
  const router = useRouter();
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    depth = 0,
    index = 0,
    name = '',
    ticker,
    dayChangePct,
    opinion,
    sector,
  } = props;

  // Root and sector containers: children paint over them, so render nothing.
  if (depth !== 2 || !ticker || width <= 0 || height <= 0) return <g />;

  const change = dayChangePct ?? null;
  const showSectorCaption = index === 0 && width >= 90 && height >= 44;
  const showTicker = width >= 40 && height >= 20;
  const showChange = width >= 56 && height >= 36;
  const centerY = showSectorCaption ? y + height / 2 + 4 : y + height / 2;

  return (
    // SVG-native <a>: keyboard focus, Enter activation, and middle-click come
    // for free; onClick swaps the full navigation for Next's client routing.
    <a
      href={`/${ticker}`}
      aria-label={`${ticker}${props.name !== ticker ? ` ${props.name}` : ''}, ${
        change != null ? `${change.toFixed(2)}%` : 'no change data'
      }, market cap ${formatMarketCap(props.marketCap ?? null)}, sector ${sector ?? 'Unknown'}, signal ${opinion ?? 'HOLD'}`}
      className="cursor-pointer outline-none transition-opacity hover:opacity-80 focus-visible:opacity-80"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        router.push(`/${ticker}`);
      }}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{ fill: tileBackground(change), stroke: 'var(--background)', strokeWidth: 1 }}
      />
      {(opinion === 'BUY' || opinion === 'SELL') && (
        <rect
          x={x}
          y={y}
          width={2}
          height={height}
          style={{ fill: opinion === 'BUY' ? 'var(--success)' : 'var(--destructive)' }}
        />
      )}
      {showSectorCaption && sector && (
        <text
          x={x + 4}
          y={y + 11}
          className="font-mono"
          style={{ fill: 'var(--muted-foreground)', fontSize: 8, letterSpacing: 1.5 }}
        >
          {sector.toUpperCase()}
        </text>
      )}
      {showTicker && (
        <text
          x={x + width / 2}
          y={showChange ? centerY - 3 : centerY + 3}
          textAnchor="middle"
          className="font-mono font-bold"
          style={{ fill: 'var(--foreground)', fontSize: 11 }}
        >
          {name}
        </text>
      )}
      {showChange && (
        <text
          x={x + width / 2}
          y={centerY + 10}
          textAnchor="middle"
          className="font-mono tabular-nums"
          style={{ fill: 'var(--foreground)', fontSize: 10, opacity: 0.8 }}
        >
          {formatChange(change)}
        </text>
      )}
    </a>
  );
}

function HeatmapTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: HeatmapNode }>;
}) {
  const node = payload?.[0]?.payload;
  if (!active || !node?.ticker) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 font-mono text-xs text-popover-foreground shadow-md space-y-0.5">
      <div className="font-bold">{node.name ?? node.ticker}</div>
      <div className="text-muted-foreground">
        {node.sector ?? 'Unknown'} · {formatMarketCap(node.marketCap ?? null)}
      </div>
      <div>
        {formatChange(node.dayChangePct)} · {node.opinion}
      </div>
    </div>
  );
}

export function MarketHeatmap({ results }: MarketHeatmapProps) {
  const data = useMemo(() => {
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

    return [...groups.entries()].map(([sector, rows]) => ({
      name: sector,
      children: [...rows]
        .sort((a, b) => weight(b) - weight(a))
        .map((r) => ({ ...r, name: r.ticker, size: weight(r), sector })),
    }));
  }, [results]);

  if (results.length === 0) return null;

  return (
    <section aria-label="Sector treemap of screener tickers, tile size by market cap">
      <div className="h-[420px] w-full sm:h-[480px] md:h-[520px]">
        <Treemap
          width="100%"
          height="100%"
          data={data}
          dataKey="size"
          nameKey="name"
          isAnimationActive={false}
          content={<HeatmapCell />}
        >
          <RechartsTooltip content={<HeatmapTooltip />} isAnimationActive={false} />
        </Treemap>
      </div>
    </section>
  );
}
