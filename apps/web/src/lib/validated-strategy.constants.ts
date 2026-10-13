/**
 * Universe-level remeasurement of the shipped leader-pullback configuration
 * (docs/validation/leader-pullback-2026-10-06.md). In-sample, descriptive;
 * shown next to every per-ticker count so tiny samples are not read as edge.
 */
export const VALIDATED_STRATEGY = {
  measuredOn: '2026-10-06',
  reportPath: 'docs/validation/leader-pullback-2026-10-06.md',
  universeTickers: 538,
  /** Non-overlapping next-open five-session trades. */
  trades: 155,
  winRatePct: 57.4,
  meanNetReturnPct: 0.63,
  /** SPY held over the same entry/exit windows. */
  spySameWindowReturnPct: 0.58,
  holdSessions: 5,
  costBpsRoundTrip: 10,
} as const;

export function validatedStrategySummaryKo(): string {
  const v = VALIDATED_STRATEGY;
  return (
    `검증 유니버스 전체 (${v.universeTickers}종목, ${v.measuredOn} 재측정, 인샘플): ` +
    `비중복 거래 n=${v.trades}, 승률 ${v.winRatePct}%, 평균 +${v.meanNetReturnPct}%/거래 · ` +
    `SPY 동일 구간 +${v.spySameWindowReturnPct}%`
  );
}
