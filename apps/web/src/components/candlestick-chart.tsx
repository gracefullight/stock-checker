'use client';

import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
} from 'lightweight-charts';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';
import { GaussianBandSeries } from '@/components/gaussian-band-series';
import { Skeleton } from '@/components/ui/skeleton';
import type { OHLCVCandle } from '@/lib/api';
import { getOHLCV } from '@/lib/api';

/** Format a lightweight-charts Time (string / BusinessDay / UNIX seconds) as YYYY-MM-DD. */
function toIsoDate(time: unknown): string {
  if (typeof time === 'string') return time;
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10);
  if (time && typeof time === 'object' && 'year' in time) {
    const b = time as { year: number; month: number; day: number };
    return `${b.year}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`;
  }
  return String(time);
}

/** Convert a #rrggbb hex (from readToken) to an rgba() string with alpha. */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const int = Number.parseInt(m[1], 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}

interface Props {
  ticker: string;
  days?: number;
}

type LinePoint = { time: string; value: number } | { time: string };

function toLineData(
  candles: OHLCVCandle[],
  key: 'sma20' | 'sma50' | 'sma200' | 'bbUpper' | 'bbLower'
): LinePoint[] {
  return candles.map((d) => {
    const v = d[key];
    return v !== null ? { time: d.time, value: v } : { time: d.time };
  });
}

/**
 * Read a CSS custom property from the document root.
 * Returns the full trimmed value string, e.g. "oklch(0.65 0.2 145)".
 */
function readToken(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return '#000000';
  // lightweight-charts' canvas color parser only understands legacy color
  // strings (hex/rgb), not oklch()/lab(). The canvas fillStyle getter can still
  // echo back lab() in some browsers, so paint a 1px pixel and read the actual
  // rendered sRGB bytes — this always yields a #rrggbb hex regardless of the
  // source color space.
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '#000000';
  ctx.fillStyle = raw;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function CandlestickChart({ ticker, days = 180 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const dataRef = useRef<OHLCVCandle[]>([]);
  const { resolvedTheme } = useTheme();

  // biome-ignore lint/correctness/useExhaustiveDependencies: chart is fully recreated on ticker/days/theme change; resolvedTheme re-reads CSS tokens for light/dark. Other refs are intentionally excluded to avoid redundant rebuilds.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Resolve all colors from CSS tokens at runtime so they react to theme changes.
    const successColor = readToken('--success');
    const destructiveColor = readToken('--destructive');
    const warningColor = readToken('--warning');
    const primaryColor = readToken('--primary');
    const cardColor = readToken('--card');
    const borderColor = readToken('--border');
    const mutedFgColor = readToken('--muted-foreground');
    const chart1Color = readToken('--chart-1');

    const chart = createChart(container, {
      layout: {
        background: { color: cardColor },
        textColor: mutedFgColor,
        fontSize: 11,
        fontFamily: 'ui-monospace, monospace',
      },
      grid: {
        vertLines: { color: borderColor },
        horzLines: { color: borderColor },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor },
      timeScale: {
        borderColor,
        timeVisible: true,
        // Axis ticks as ISO date instead of lightweight-charts' "10 Mar '26".
        tickMarkFormatter: (time: unknown) => toIsoDate(time),
      },
      // Crosshair / legend label as YYYY-MM-DD (daily bars — no intraday time).
      localization: {
        timeFormatter: (time: unknown) => toIsoDate(time),
      },
      width: container.clientWidth,
      height: 380,
    });

    // --- Gaussian Channel translucent fill (drawn first = behind candles) ---
    const gcBandSeries = chart.addCustomSeries(new GaussianBandSeries(), {
      colorUp: hexToRgba(successColor, 0.13),
      colorDown: hexToRgba(destructiveColor, 0.13),
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // --- candles ---
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: successColor,
      downColor: destructiveColor,
      borderUpColor: successColor,
      borderDownColor: destructiveColor,
      wickUpColor: successColor,
      wickDownColor: destructiveColor,
    });

    // --- MA lines: SMA20=warning, SMA50=primary, SMA200=chart-1 ---
    const sma20Series = chart.addSeries(LineSeries, {
      color: warningColor,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const sma50Series = chart.addSeries(LineSeries, {
      color: primaryColor,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const sma200Series = chart.addSeries(LineSeries, {
      color: chart1Color,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // --- Bollinger Bands ---
    const bbUpperSeries = chart.addSeries(LineSeries, {
      color: mutedFgColor,
      lineWidth: 1,
      lineStyle: 2, // dashed
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const bbLowerSeries = chart.addSeries(LineSeries, {
      color: mutedFgColor,
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // --- Gaussian Channel: a trend-colored ENVELOPE (upper + lower + mid),
    //     green = uptrend (filter rising), red = downtrend. Both band edges are
    //     colored so it reads as a channel, not just lines. Color flip = reversal.
    const gcSeries = (color: string, width: 1 | 2) =>
      chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    const gcUpperUp = gcSeries(successColor, 1);
    const gcUpperDown = gcSeries(destructiveColor, 1);
    const gcLowerUp = gcSeries(successColor, 1);
    const gcLowerDown = gcSeries(destructiveColor, 1);

    // --- volume pane ---
    const volumePane = chart.addPane();
    const volumeSeries = volumePane.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
    });

    const applyData = (data: OHLCVCandle[]) => {
      candleSeries.setData(data);
      sma20Series.setData(toLineData(data, 'sma20'));
      sma50Series.setData(toLineData(data, 'sma50'));
      sma200Series.setData(toLineData(data, 'sma200'));
      bbUpperSeries.setData(toLineData(data, 'bbUpper'));
      bbLowerSeries.setData(toLineData(data, 'bbLower'));

      // Gaussian Channel: each band line split into green/red segments by the
      // bar's trend direction (whitespace gaps where the other color owns the bar).
      const gcSplit = (key: 'gaussianUpper' | 'gaussianLower' | 'gaussianMid', green: boolean) =>
        data.map((d) =>
          d.gaussianGreen === green ? { time: d.time, value: d[key] } : { time: d.time }
        );
      gcUpperUp.setData(gcSplit('gaussianUpper', true));
      gcUpperDown.setData(gcSplit('gaussianUpper', false));
      gcLowerUp.setData(gcSplit('gaussianLower', true));
      gcLowerDown.setData(gcSplit('gaussianLower', false));
      gcBandSeries.setData(
        data.map((d) => ({
          time: d.time,
          upper: d.gaussianUpper,
          lower: d.gaussianLower,
          green: d.gaussianGreen,
        }))
      );

      // Volume bars — lightweight-charts' canvas parser only understands legacy
      // color strings, so append an 8-digit-hex alpha ("20" ≈ 12.5%) to the
      // hex returned by readToken rather than using oklch()/color-mix().
      volumeSeries.setData(
        data.map((d) => ({
          time: d.time,
          value: d.volume,
          color: d.close >= d.open ? `${successColor}33` : `${destructiveColor}33`,
        }))
      );

      // signal markers
      const markers = data
        .filter((d) => d.signal === 'BUY' || d.signal === 'SELL')
        .map((d) => ({
          time: d.time as import('lightweight-charts').Time,
          position: (d.signal === 'BUY' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
          shape: (d.signal === 'BUY' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
          color: d.signal === 'BUY' ? successColor : destructiveColor,
          text: d.signal!,
          size: 1,
        }));
      if (markers.length > 0) {
        createSeriesMarkers(candleSeries, markers);
      }

      chart.timeScale().fitContent();
    };

    if (dataRef.current.length > 0) {
      // Re-apply existing data when theme changes (chart was re-created with new colors)
      applyData(dataRef.current);
      setStatus('ready');
    } else {
      setStatus('loading');
      getOHLCV(ticker, days)
        .then((data) => {
          dataRef.current = data;
          applyData(data);
          setStatus('ready');
        })
        .catch(() => setStatus('error'));
    }

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
    };
    // resolvedTheme in deps ensures the chart re-creates with new token values on theme switch
  }, [ticker, days, resolvedTheme]);

  const legendItems = [
    { tokenVar: '--warning', label: 'SMA20' },
    { tokenVar: '--primary', label: 'SMA50' },
    { tokenVar: '--chart-1', label: 'SMA200' },
    { tokenVar: '--muted-foreground', label: 'BB', dashed: true },
    { tokenVar: '--success', label: 'GC (trend)' },
  ];

  if (status === 'error') {
    return (
      <div className="h-[420px] flex items-center justify-center font-mono text-xs text-destructive">
        CHART DATA UNAVAILABLE
      </div>
    );
  }

  return (
    <div className="relative w-full">
      {status === 'loading' && (
        <Skeleton className="absolute inset-0 h-[420px] z-10 rounded-none" />
      )}
      <div
        ref={containerRef}
        className="w-full"
        role="img"
        aria-label={`${ticker} daily price candlestick chart with SMA 20/50/200, Bollinger Bands, and volume. See the technical indicators table below for the underlying values.`}
      />
      {status === 'ready' && (
        <div className="flex gap-4 px-1 pt-1">
          {legendItems.map(({ tokenVar, label, dashed }) => (
            <LegendItem key={label} colorVar={tokenVar} label={label} dashed={dashed} />
          ))}
        </div>
      )}
    </div>
  );
}

function LegendItem({
  colorVar,
  label,
  dashed,
}: {
  colorVar: string;
  label: string;
  dashed?: boolean;
}) {
  const cssColor = `var(${colorVar})`;
  return (
    <div className="flex items-center gap-1">
      <span
        className="w-5 h-px"
        style={{
          background: dashed ? 'transparent' : cssColor,
          borderTop: dashed ? `1px dashed ${cssColor}` : `1px solid ${cssColor}`,
          display: 'inline-block',
        }}
      />
      <span className="font-mono text-[10px]" style={{ color: cssColor }}>
        {label}
      </span>
    </div>
  );
}
