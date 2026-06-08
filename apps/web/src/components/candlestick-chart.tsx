'use client';

import { CandlestickSeries, HistogramSeries, createChart } from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { getOHLCV } from '@/lib/api';

interface Props {
  ticker: string;
  days?: number;
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
      height: 320,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00ff88',
      downColor: '#ff3333',
      borderUpColor: '#00ff88',
      borderDownColor: '#ff3333',
      wickUpColor: '#00ff88',
      wickDownColor: '#ff3333',
    });

    const volumePane = chart.addPane();
    const volumeSeries = volumePane.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
    });

    getOHLCV(ticker, days)
      .then((data) => {
        candleSeries.setData(data);
        volumeSeries.setData(
          data.map((d) => ({
            time: d.time,
            value: d.volume,
            color: d.close >= d.open ? '#00ff8833' : '#ff333333',
          }))
        );
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
      <div className="h-[400px] flex items-center justify-center font-mono text-xs text-[var(--red)]">
        CHART DATA UNAVAILABLE
      </div>
    );
  }

  return (
    <div className="relative w-full">
      {status === 'loading' && (
        <div className="absolute inset-0 bg-[var(--surface)] animate-pulse z-10" />
      )}
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
