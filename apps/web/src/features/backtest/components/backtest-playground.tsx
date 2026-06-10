'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { BacktestControls } from '@/features/backtest/components/backtest-controls';
import { BacktestMetrics } from '@/features/backtest/components/backtest-metrics';
import { BacktestTradeTable } from '@/features/backtest/components/backtest-trade-table';
import { EquityCurveChart } from '@/features/backtest/components/equity-curve-chart';
import {
  buildPipelineConfig,
  DEFAULT_PLAYGROUND_PARAMS,
  type PlaygroundParams,
} from '@/features/backtest/utils/config';
import { useBacktestWorker } from '@/features/backtest/utils/use-backtest-worker';
import { type BacktestDataResponse, getBacktestData } from '@/lib/api';

interface BacktestPlaygroundProps {
  ticker: string;
}

const OPTIMIZE_TRIALS = 150;

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="border-b border-border py-1.5 px-3">
        <span className="text-[10px] font-mono font-bold tracking-widest text-primary">
          {title}
        </span>
      </CardHeader>
      <CardContent className="p-3">{children}</CardContent>
    </Card>
  );
}

export function BacktestPlayground({ ticker }: BacktestPlaygroundProps) {
  const [params, setParams] = useState<PlaygroundParams>(DEFAULT_PLAYGROUND_PARAMS);
  const [data, setData] = useState<BacktestDataResponse | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const { state, run, optimize, cancel } = useBacktestWorker();

  useEffect(() => {
    let cancelled = false;
    getBacktestData(ticker)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) {
          setDataError(err instanceof Error ? err.message : 'Failed to load candle data');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (dataError) {
    return (
      <div
        className="p-4 border border-destructive bg-card font-mono text-xs text-destructive"
        role="alert"
      >
        ERROR: {dataError}
      </div>
    );
  }

  if (!data) {
    return <Skeleton className="h-[400px] w-full rounded-none" aria-label="Loading candle data" />;
  }

  const busy = state.status !== 'idle';
  const payload = {
    ticker: data.ticker,
    candles: data.candles,
    spy: data.spy,
    sector: data.sector,
  };

  return (
    <div className="space-y-4">
      <SectionCard title="PARAMETERS">
        <BacktestControls value={params} onChange={setParams} disabled={busy} />
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            className="font-mono text-xs"
            disabled={busy}
            onClick={() => run(payload, buildPipelineConfig(params))}
          >
            {state.status === 'running' ? 'RUNNING…' : 'RUN BACKTEST'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="font-mono text-xs"
            disabled={busy}
            onClick={() => optimize(payload, OPTIMIZE_TRIALS)}
          >
            {state.status === 'optimizing' ? 'OPTIMIZING…' : `OPTIMIZE (${OPTIMIZE_TRIALS})`}
          </Button>
          {busy && (
            <Button size="sm" variant="ghost" className="font-mono text-xs" onClick={cancel}>
              CANCEL
            </Button>
          )}
          <span className="font-mono text-[10px] text-muted-foreground ml-auto">
            {data.candles.length} BARS · SPY {data.spy.length} · SECTOR{' '}
            {data.sector ? data.sector.etf : 'N/A'}
          </span>
        </div>
        {state.optimizeProgress && (
          <div className="mt-3 space-y-1">
            <Progress
              value={(state.optimizeProgress.trial / state.optimizeProgress.nTrials) * 100}
              aria-label="Optimization progress"
            />
            <div className="font-mono text-[10px] text-muted-foreground">
              TRIAL {state.optimizeProgress.trial}/{state.optimizeProgress.nTrials}
              {Number.isFinite(state.optimizeProgress.bestValue) &&
                ` · BEST ${state.optimizeProgress.bestValue.toFixed(4)}`}
            </div>
          </div>
        )}
        {state.error && (
          <div className="mt-3 font-mono text-xs text-destructive" role="alert">
            ERROR: {state.error}
          </div>
        )}
      </SectionCard>

      {state.bestParams && (
        <SectionCard title="OPTIMIZER BEST PARAMS (mean-reversion search)">
          <pre className="font-mono text-[10px] text-muted-foreground overflow-x-auto max-h-48">
            {JSON.stringify(
              {
                thresholds: state.bestParams.thresholds,
                confluence: state.bestParams.confluence,
                clusterFilter: state.bestParams.clusterFilter,
                trendGate: state.bestParams.trendGate,
              },
              null,
              2
            )}
          </pre>
        </SectionCard>
      )}

      {state.result && (
        <>
          <BacktestMetrics result={state.result} />
          <SectionCard title="EQUITY CURVE (5-bar hold, compounded)">
            <EquityCurveChart points={state.result.equity.points} />
          </SectionCard>
          <SectionCard title={`TRADES (${state.result.trades.length})`}>
            <BacktestTradeTable trades={state.result.trades} />
          </SectionCard>
        </>
      )}

      {!state.result && !busy && (
        <div className="p-6 text-center font-mono text-xs text-muted-foreground border border-border bg-card">
          Adjust parameters and RUN BACKTEST — the engine runs in a Web Worker on{' '}
          {data.candles.length} daily bars.
        </div>
      )}
    </div>
  );
}
