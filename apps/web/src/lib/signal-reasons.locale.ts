import type { TickerResult } from '@stock-checker/core/src/types';
import type { SignalBlock, SignalCheck, SignalGateExtras } from '@/lib/signal-gates.types';
import { deriveSignalVisual, type SignalThresholds } from '@/lib/signal-visuals';

/**
 * Single Korean locale for engine decision reasons. Keyed by reason codes and
 * structured gates so every surface (detail page, screener, market screen)
 * renders the same wording; the English sentence translators are a bridge for
 * responses that still carry only `gateReasons` strings.
 */
export type ReasonCode =
  | 'trend-gate'
  | 'score-threshold'
  | 'confluence'
  | 'reversal'
  | 'institutional'
  | 'quality-blocked'
  | 'cluster'
  | 'hold-no-entry'
  | 'sell-exit-warning'
  | 'buy-conditional';

export const GATE_LABEL_KO: Record<string, string> = {
  trend: '추세 게이트 (Gaussian Channel)',
  regime: '시장 국면 필터',
  score: '매수 점수 기준',
  cluster: '클러스터 필터 (최근 BUY 이후 재진입 제한)',
  quality: '진입 품질 게이트 (풀백)',
  confluence: '지표 합치도',
  reversal: '반전 확인',
  institutional: '기관 수급 점수',
  market: '시장 킬스위치 (SPY 추세)',
};

export const CHECK_LABEL_KO: Record<string, string> = {
  ibs: 'IBS (종가 위치)',
  atrPct: 'ATR% (변동성)',
  volumeRatio: '거래량 비율',
  volRMin: '거래량 비율 하한',
  volRMax: '거래량 비율 상한',
  scoreMax: '매수 점수 상한 (과열)',
  rsSpy: '시장 대비 상대강도',
  rsSector: '섹터 대비 상대강도',
  belowSma50: 'SMA50 아래 풀백',
  aboveSma200: 'SMA200 위 (장기 추세)',
  vwap: 'VWAP 위 매집',
  marketUptrend: 'SPY 상승 국면',
  trend: '추세',
  buyScore: '매수 점수',
};

const REGIME_KO: Record<string, string> = {
  uptrend: '상승 추세',
  downtrend: '하락 추세',
  sideways: '횡보',
  unknown: '판단 불가',
};

const TREND_REASON_KO: Array<[RegExp, string]> = [
  [/upward trend|uptrend/i, '상승 추세'],
  [/downward trend|downtrend/i, '하락 추세'],
  [/sideways/i, '횡보'],
  [/gaussian/i, 'Gaussian Channel 기준'],
];

function trendReasonKo(reason: string): string {
  for (const [pattern, ko] of TREND_REASON_KO) if (pattern.test(reason)) return ko;
  return reason;
}

const SENTENCE_KO: Array<{
  code: ReasonCode;
  pattern: RegExp;
  render: (m: RegExpMatchArray) => string;
}> = [
  {
    code: 'trend-gate',
    pattern: /^BUY trend gate: (.+?); (passed|blocked)\.$/,
    render: (m) => `추세 게이트: ${trendReasonKo(m[1])} · ${m[2] === 'passed' ? '통과' : '차단'}`,
  },
  {
    code: 'score-threshold',
    pattern:
      /^BUY score ([\d.]+) \/ threshold ([\d.]+); SELL score ([\d.]+) \/ threshold ([\d.]+)\.$/,
    render: (m) =>
      `매수 점수 ${Number(m[1]).toFixed(1)} / 기준 ${m[2]} · 매도 점수 ${Number(m[3]).toFixed(1)} / 기준 ${m[4]}`,
  },
  {
    code: 'confluence',
    pattern: /^Confluence: (\d+)\/(\d+); (passed|not passed or not evaluated)\.$/,
    render: (m) =>
      `지표 합치도 ${m[1]}/${m[2]} · ${m[3] === 'passed' ? '통과' : '미통과 또는 미평가'}`,
  },
  {
    code: 'reversal',
    pattern: /^Reversal: (confirmed|rejected); trigger (.+)\.$/,
    render: (m) =>
      `반전 확인: ${m[1] === 'confirmed' ? '확인' : '미확인'} · 트리거 ${
        m[2].startsWith('none') ? '없음 / 미평가 (이 전략에서는 비활성)' : m[2]
      }`,
  },
  {
    code: 'institutional',
    pattern: /^Institutional score ([\d.]+); (passed|below threshold)\..*$/,
    render: (m) =>
      `기관 수급 점수 ${m[1]} · ${
        m[2] === 'passed' ? '기준 이상' : '기준 미만'
      } (매수 점수에 블렌딩되는 참고 지표, 단독 게이트 아님)`,
  },
  {
    code: 'quality-blocked',
    pattern: /^The entry-quality gate rejected this score-qualified BUY setup\.$/,
    render: () =>
      '진입 품질 게이트가 점수 통과 BUY 셋업을 차단했습니다 (풀백 조건 미충족 또는 과열)',
  },
  {
    code: 'hold-no-entry',
    pattern:
      /^No entry: the complete BUY path did not pass or neither eligible decision qualified\.$/,
    render: () => '진입 없음: BUY 경로를 모두 통과하지 못했거나 어떤 결정도 기준을 충족하지 않음',
  },
  {
    code: 'sell-exit-warning',
    pattern: /^SELL is a long-holder exit warning, not a short-entry recommendation\.$/,
    render: () => 'SELL은 보유자 청산 경고이며 공매도 진입 추천이 아닙니다',
  },
  {
    code: 'buy-conditional',
    pattern:
      /^BUY qualifies at the completed close; execution remains conditional on the next session open\.$/,
    render: () => '완료된 종가 기준 BUY 충족 · 실제 진입은 다음 세션 시가에 조건부',
  },
];

/** Translate one English engine reason; unknown sentences pass through unchanged. */
export function translateGateReason(reason: string): string {
  for (const entry of SENTENCE_KO) {
    const match = reason.match(entry.pattern);
    if (match) return entry.render(match);
  }
  return reason;
}

export function reasonCodeOf(reason: string): ReasonCode | null {
  for (const entry of SENTENCE_KO) if (entry.pattern.test(reason)) return entry.code;
  return null;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
}

export function describeCheck(check: SignalCheck): string {
  const label = check.label ?? CHECK_LABEL_KO[check.id] ?? check.id;
  const status = check.passed ? '통과' : '실패';
  if (check.value === undefined && check.limit === undefined) return `${label}: ${status}`;
  const comparator = check.comparator ?? '';
  const limit =
    check.limit === undefined ? '' : ` ${comparator || 'vs'} 한도 ${formatNumber(check.limit)}`;
  return `${label}: ${formatNumber(check.value)}${limit} → ${status}`;
}

/** Korean lines for a structured blocker, failed checks first. */
export function describeBlock(block: SignalBlock): string[] {
  const lines = [`차단 게이트: ${GATE_LABEL_KO[block.gate] ?? block.gate}`];
  if (block.reason) lines.push(translateGateReason(block.reason));
  const checks = block.checks ?? [];
  for (const check of checks.filter((c) => !c.passed)) lines.push(describeCheck(check));
  for (const check of checks.filter((c) => c.passed)) lines.push(describeCheck(check));
  if (block.lastSetupDate) lines.push(`최근 셋업 소비일: ${block.lastSetupDate}`);
  if (block.nextEligibleDate) lines.push(`재진입 가능일: ${block.nextEligibleDate}`);
  return lines;
}

/**
 * Korean decision summary for the detail page. Uses structured blockers when
 * the API provides them, then string reasons, then the fields every
 * TickerResult already carries.
 */
export function describeTickerDecision(
  result: TickerResult & SignalGateExtras,
  thresholds: SignalThresholds
): string[] {
  const visual = deriveSignalVisual({
    decision: result.opinion,
    score: result.score,
    buyScore: result.buyScore,
    thresholds,
  });
  const lines: string[] = [visual.description];
  if (result.blockedBy) {
    lines.push(...describeBlock(result.blockedBy));
    return lines;
  }
  if (result.gateReasons?.length) {
    lines.push(...result.gateReasons.map(translateGateReason));
    return lines;
  }
  if (result.trendRegime) {
    const regime = REGIME_KO[result.trendRegime] ?? result.trendRegime;
    lines.push(
      `추세 게이트: ${regime} · ${result.trendRegime === 'uptrend' ? '통과' : '차단 (상승 추세에서만 BUY)'}`
    );
  }
  if (result.institutionalScore !== undefined) {
    lines.push(
      `기관 수급 점수 ${result.institutionalScore.toFixed(3)} · ${
        result.institutionalPassed ? '기준 이상' : '기준 미만'
      } (매수 점수에 블렌딩되는 참고 지표)`
    );
  }
  if (result.confluenceRatio !== undefined) {
    lines.push(`지표 합치도 ${(result.confluenceRatio * 100).toFixed(0)}%`);
  }
  if (result.qualityBlocked || (visual.state === 'blocked' && result.trendRegime === 'uptrend')) {
    lines.push(
      result.qualityBlocked
        ? '진입 품질 게이트가 점수 통과 BUY 셋업을 차단했습니다 (풀백 조건 미충족 또는 과열)'
        : '점수와 추세는 통과: 클러스터 필터 또는 진입 품질 게이트(IBS·ATR%·상대강도·SMA50 풀백·점수 상한)에서 차단된 것으로 보입니다'
    );
  }
  if (visual.state === 'sell')
    lines.push('SELL은 보유자 청산 경고이며 공매도 진입 추천이 아닙니다');
  if (visual.state === 'buy')
    lines.push('완료된 종가 기준 BUY 충족 · 실제 진입은 다음 세션 시가에 조건부');
  return lines;
}
