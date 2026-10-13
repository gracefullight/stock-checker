import { VALIDATED_STRATEGY, validatedStrategySummaryKo } from '@/lib/validated-strategy.constants';

interface ValidatedStrategyNoteProps {
  /** Per-ticker or per-job counts to show beside the universe-level statistic. */
  perSample?: Array<{ label: string; value: string }>;
  className?: string;
}

/**
 * Universe-level validated statistic shown next to every small-sample count,
 * so a per-ticker n=1 win rate is read against the measured strategy, not as
 * evidence on its own.
 */
export function ValidatedStrategyNote({ perSample, className }: ValidatedStrategyNoteProps) {
  const v = VALIDATED_STRATEGY;
  return (
    <aside
      aria-label="Validated strategy statistic"
      className={`rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] text-muted-foreground ${className ?? ''}`}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <div>
          <dt className="text-[10px] tracking-widest">검증 거래 n</dt>
          <dd className="text-foreground tabular-nums">{v.trades}</dd>
        </div>
        <div>
          <dt className="text-[10px] tracking-widest">승률 (인샘플)</dt>
          <dd className="text-foreground tabular-nums">{v.winRatePct}%</dd>
        </div>
        <div>
          <dt className="text-[10px] tracking-widest">평균 순수익/거래</dt>
          <dd className="text-foreground tabular-nums">+{v.meanNetReturnPct}%</dd>
        </div>
        <div>
          <dt className="text-[10px] tracking-widest">SPY 동일 구간</dt>
          <dd className="text-foreground tabular-nums">+{v.spySameWindowReturnPct}%</dd>
        </div>
        {perSample?.map((item) => (
          <div key={item.label}>
            <dt className="text-[10px] tracking-widest">{item.label}</dt>
            <dd className="text-foreground tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1">
        {validatedStrategySummaryKo()} · 다음 세션 시가 진입, {v.holdSessions}번째 세션 종가 청산,
        왕복 비용 {v.costBpsRoundTrip}bps. 미래 승률이 아닌 과거 재측정값이며 종목별 소표본 수치는
        이 기준과 함께 읽어야 합니다. 보고서: {v.reportPath}
      </p>
    </aside>
  );
}
