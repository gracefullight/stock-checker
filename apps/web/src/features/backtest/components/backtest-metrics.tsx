import type { RunResultDTO } from '@/features/backtest/types/protocol';

interface BacktestMetricsProps {
  result: RunResultDTO;
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'destructive' | 'warning';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'destructive'
        ? 'text-destructive'
        : tone === 'warning'
          ? 'text-warning'
          : 'text-foreground';
  return (
    <div className="border border-border bg-card p-2">
      <div className="font-mono text-[10px] tracking-widest text-muted-foreground">{label}</div>
      <div className={`font-mono text-lg font-bold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

export function BacktestMetrics({ result }: BacktestMetricsProps) {
  const { winRate, equity } = result;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      <Metric
        label="WIN RATE (5D)"
        value={`${winRate.winRate5d.toFixed(1)}%`}
        tone={
          winRate.winRate5d >= 55 ? 'success' : winRate.winRate5d >= 45 ? 'warning' : 'destructive'
        }
      />
      <Metric
        label="REWARD / RISK"
        value={winRate.rewardRisk.toFixed(2)}
        tone={winRate.rewardRisk >= 1.2 ? 'success' : undefined}
      />
      <Metric label="TRADES" value={String(winRate.totalSignals)} />
      <Metric
        label="AVG RETURN"
        value={`${winRate.avgReturn >= 0 ? '+' : ''}${winRate.avgReturn.toFixed(2)}%`}
        tone={winRate.avgReturn >= 0 ? 'success' : 'destructive'}
      />
      <Metric
        label="TOTAL RETURN"
        value={`${equity.totalReturn >= 0 ? '+' : ''}${equity.totalReturn.toFixed(1)}%`}
        tone={equity.totalReturn >= 0 ? 'success' : 'destructive'}
      />
      <Metric
        label="MAX DRAWDOWN"
        value={`-${equity.maxDrawdown.toFixed(1)}%`}
        tone={equity.maxDrawdown > 20 ? 'destructive' : undefined}
      />
    </div>
  );
}
