import type { MarketScreenJob } from '@/reports/market-screen';
import type { TickerAnalysisUnavailable } from '@/services/ticker-analysis';

export interface ScreenAnalysisUnavailable {
  ticker: string;
  reason: string;
  diagnostics?: TickerAnalysisUnavailable;
}

/** Describe known analysis failures without exposing provider messages or values. */
export function describeAnalysisUnavailable(
  diagnostic: TickerAnalysisUnavailable | undefined
): string {
  switch (diagnostic?.code) {
    case 'history-unavailable':
      return '완료된 거래일의 가격 이력을 가져올 수 없습니다.';
    case 'invalid-price-or-atr':
      return '유효한 종가 또는 평균 가격 변동폭을 확인할 수 없습니다.';
    case 'risk-levels-infeasible':
      return '평균 가격 변동폭 기준으로 유효한 손절·목표가를 산정할 수 없습니다.';
    default:
      return '완료된 거래일 기준 분석을 사용할 수 없습니다.';
  }
}

/** Evaluation success is independent of how much of the source was collected. */
export function formatScreenEvaluation({
  total,
  analyzed,
  unavailable,
}: {
  total: number;
  analyzed: number;
  unavailable: number;
}): string {
  if (analyzed === total && unavailable === 0) return `평가 완료 ${analyzed}/${total}`;
  return `평가 ${analyzed}/${total}${unavailable > 0 ? ` · 분석 불가 ${unavailable}` : ''}`;
}

export function formatMarketScreenTitle(
  job: MarketScreenJob,
  prefix = '시장 후보 스크리닝'
): string {
  return `${prefix} · ${job.criteria.decision} · ${formatScreenEvaluation(job.progress)} · Finviz 후보 ${job.universe.collectedCount}/${job.universe.sourceTotal}`;
}
