import type { MarketScreenJob } from '@/reports/market-screen';
import type { TickerAnalysisUnavailable } from '@/services/ticker-analysis';

export interface ScreenAnalysisUnavailable {
  ticker: string;
  reason: string;
  diagnostics?: TickerAnalysisUnavailable;
}

export interface ScreeningNotificationContext {
  decision: 'BUY' | 'SELL' | 'HOLD' | 'ALL';
  analyzed: number;
  matched: number;
  unavailable: readonly ScreenAnalysisUnavailable[];
}

const NOTIFICATION_DIAGNOSTIC_GROUPS = [
  { code: 'risk-levels-infeasible', label: '손절·목표가 미산정' },
  { code: 'history-unavailable', label: '가격 이력 미확보' },
  { code: 'invalid-price-or-atr', label: '종가·변동폭 확인 불가' },
  { code: 'unknown', label: '데이터 확인 불가' },
] as const;

function notificationCount(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)))
    : 0;
}

function notificationTicker(ticker: string): string | null {
  const normalized = ticker.trim().toUpperCase();
  return /^[A-Z0-9^][A-Z0-9.^=-]{0,11}$/.test(normalized) ? normalized : null;
}

export function formatScreeningOutcome(context: ScreeningNotificationContext): string {
  const { decision, unavailable } = context;
  const analyzed = notificationCount(context.analyzed);
  const matched = notificationCount(context.matched);
  const outcome =
    analyzed > 0 || unavailable.length === 0
      ? decision === 'ALL'
        ? `분석 결과 ${matched}개.`
        : `${decision} 조건 충족 ${matched}개 (분석 ${analyzed}개 기준).`
      : decision === 'ALL'
        ? '분석 결과를 확인할 수 없습니다.'
        : `분석 결과가 없어 ${decision} 조건 충족 여부를 확인할 수 없습니다.`;
  const lines = [outcome];

  for (const { code, label } of NOTIFICATION_DIAGNOSTIC_GROUPS) {
    const failures = unavailable.filter((failure) => {
      const known = NOTIFICATION_DIAGNOSTIC_GROUPS.some(
        (group) => group.code !== 'unknown' && group.code === failure.diagnostics?.code
      );
      return code === 'unknown' ? !known : failure.diagnostics?.code === code;
    });
    if (failures.length === 0) continue;
    const tickers = [...new Set(failures.map(({ ticker }) => notificationTicker(ticker)))].filter(
      (ticker): ticker is string => ticker !== null
    );
    const examples = tickers.sort().slice(0, 5);
    const remaining = failures.length - examples.length;
    const details =
      examples.length > 0
        ? `: ${examples.join(', ')}${remaining > 0 ? ` 외 ${remaining}종목` : ''}`
        : '';
    lines.push(`${label} ${failures.length}종목${details}.`);
  }

  return lines.join('\n');
}

export function formatScreenDecision({
  decision,
  analyzed,
  matched,
  total,
}: {
  decision: ScreeningNotificationContext['decision'];
  analyzed: number;
  matched: number;
  total: number;
}): string {
  const available = analyzed > 0 || total === 0;
  if (decision === 'ALL') {
    return available ? `ALL · 일치 ${notificationCount(matched)}개` : 'ALL · 확인 불가';
  }
  return available ? `${decision} ${notificationCount(matched)}개` : `${decision} 확인 불가`;
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
  return `평가 ${analyzed}/${total}${unavailable > 0 ? ` · 미산정 ${unavailable}종목` : ''}`;
}

export function formatMarketScreenTitle(
  job: MarketScreenJob,
  prefix = '시장 후보 스크리닝'
): string {
  return `${prefix} · ${formatScreenDecision({ decision: job.criteria.decision, ...job.progress })} · ${formatScreenEvaluation(job.progress)} · Finviz 후보 ${job.universe.collectedCount}/${job.universe.sourceTotal}`;
}
