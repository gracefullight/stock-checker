'use client';

import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import type { OHLCVCandle } from '@/lib/api';
import { getOHLCV } from '@/lib/api';

interface Props {
  ticker: string;
  days?: number;
}

type LinePoint = { time: string; value: number } | { time: string };

function toLineData(candles: OHLCVCandle[], key: 'sma20' | 'sma50' | 'sma200' | 'bbUpper' | 'bbLower'): LinePoint[] {
  return candles.map((d) => {
    const v = d[key];
    return v !== null ? { time: d.time, value: v } : { time: d.time };
  });
}

export function CandlestickChart({ ticker, days = 180 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { color: '#111111' },
        textColor: '#666666',
        fontSize: 11,
        fontFamily: 'ui-monospace, monospace',
      },
      grid: {
        vertLines: { color: '#1f1f1f' },
        horzLines: { color: '#1f1f1f' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#1f1f1f' },
      timeScale: { borderColor: '#1f1f1f', timeVisible: true },
      width: container.clientWidth,
      height: 380,
    });

    // --- candles ---
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00ff88',
      downColor: '#ff3333',
      borderUpColor: '#00ff88',
      borderDownColor: '#ff3333',
      wickUpColor: '#00ff88',
      wickDownColor: '#ff3333',
    });

    // --- MA lines ---
    const sma20Series = chart.addSeries(LineSeries, {
      color: '#f5c518',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const sma50Series = chart.addSeries(LineSeries, {
      color: '#4488ff',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const sma200Series = chart.addSeries(LineSeries, {
      color: '#ff8844',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // --- Bollinger Bands ---
    const bbUpperSeries = chart.addSeries(LineSeries, {
      color: '#888888',
      lineWidth: 1,
      lineStyle: 2, // dashed
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const bbLowerSeries = chart.addSeries(LineSeries, {
      color: '#888888',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // --- volume pane ---
    const volumePane = chart.addPane();
    const volumeSeries = volumePane.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
    });

    getOHLCV(ticker, days)
      .then((data) => {
        candleSeries.setData(data);
        sma20Series.setData(toLineData(data, 'sma20'));
        sma50Series.setData(toLineData(data, 'sma50'));
        sma200Series.setData(toLineData(data, 'sma200'));
        bbUpperSeries.setData(toLineData(data, 'bbUpper'));
        bbLowerSeries.setData(toLineData(data, 'bbLower'));

        volumeSeries.setData(
          data.map((d) => ({
            time: d.time,
            value: d.volume,
            color: d.close >= d.open ? '#00ff8833' : '#ff333333',
          }))
        );

        // signal markers
        const markers = data
          .filter((d) => d.signal === 'BUY' || d.signal === 'SELL')
          .map((d) => ({
            time: d.time as import('lightweight-charts').Time,
            position: (d.signal === 'BUY' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
            shape: (d.signal === 'BUY' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
            color: d.signal === 'BUY' ? '#00ff88' : '#ff3333',
            text: d.signal!,
            size: 1,
          }));
        if (markers.length > 0) {
          createSeriesMarkers(candleSeries, markers);
        }

        chart.timeScale().fitContent();
        setStatus('ready');
      })
      .catch(() => setStatus('error'));

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [ticker, days]);

  if (status === 'error') {
    return (
      <div className="h-[420px] flex items-center justify-center font-mono text-xs text-[var(--red)]">
        CHART DATA UNAVAILABLE
      </div>
    );
  }

  return (
    <div className="relative w-full">
      {status === 'loading' && (
        <div className="absolute inset-0 h-[420px] bg-[var(--surface)] animate-pulse z-10" />
      )}
      <div ref={containerRef} className="w-full" />
      {status === 'ready' && (
        <div className="flex gap-4 px-1 pt-1">
          <LegendItem color="#f5c518" label="SMA20" />
          <LegendItem color="#4488ff" label="SMA50" />
          <LegendItem color="#ff8844" label="SMA200" />
          <LegendItem color="#888888" label="BB" dashed />
        </div>
      )}
    </div>
  );
}

function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <span
        className="w-5 h-px"
        style={{
          background: color,
          borderTop: dashed ? `1px dashed ${color}` : `1px solid ${color}`,
          display: 'inline-block',
        }}
      />
      <span className="font-mono text-[10px]" style={{ color }}>
        {label}
      </span>
    </div>
  );
}
