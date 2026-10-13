import type { StockScreenMatch } from '@/lib/api';
import { describeCheck } from '@/lib/signal-reasons.locale';
import { DEFAULT_SIGNAL_THRESHOLDS } from '@/lib/signal-visuals';

export type NearMissTier =
  | 'quality-blocked'
  | 'gated'
  | 'score-near'
  | 'trend-rs-ok'
  | 'trend-ok'
  | 'trend-fail';

export interface NearMissTierInfo {
  tier: NearMissTier;
  /** 0 = closest to a BUY. */
  rank: number;
  label: string;
  /** Korean one-liner describing what still blocked the entry. */
  detail: string;
}

export interface NearMissOptions {
  buyThreshold?: number;
  rsMin?: number;
  /** Fraction of the buy threshold that counts as "near". */
  nearRatio?: number;
}

const TIER_LABEL: Record<NearMissTier, string> = {
  'quality-blocked': 'T1 · 품질 게이트 차단',
  gated: 'T1 · 점수 통과 · 기타 게이트',
  'score-near': 'T2 · 점수 근접',
  'trend-rs-ok': 'T3 · 추세·RS 통과',
  'trend-ok': 'T4 · 추세만 통과',
  'trend-fail': 'T5 · 추세 미통과',
};

const TIER_RANK: Record<NearMissTier, number> = {
  'quality-blocked': 0,
  gated: 0,
  'score-near': 1,
  'trend-rs-ok': 2,
  'trend-ok': 3,
  'trend-fail': 4,
};

const QUALITY_REASON = /entry-quality gate rejected/i;
const DEFAULT_RS_MIN = 0.7;

function failedCheckDetail(item: StockScreenMatch): string | null {
  const checks = item.blockedBy?.checks ?? item.checks;
  const failed = checks?.filter((check) => !check.passed) ?? [];
  if (failed.length === 0) return null;
  return failed.map(describeCheck).join(' · ');
}

/**
 * Rank an excluded (HOLD) screen result by how close it came to a BUY using
 * the fields every saved result already carries, preferring structured
 * blockers and checks when the API provides them.
 */
export function classifyNearMiss(
  item: StockScreenMatch,
  options: NearMissOptions = {}
): NearMissTierInfo {
  const buyThreshold = options.buyThreshold ?? DEFAULT_SIGNAL_THRESHOLDS.buy;
  const rsMin = options.rsMin ?? DEFAULT_RS_MIN;
  const nearRatio = options.nearRatio ?? 0.8;
  const trendOk = item.gates?.trend?.passed === true;
  const components = item.gates?.institutional?.components;
  const rsOk = !!components && components.rsSpy >= rsMin && components.rsSector >= rsMin;
  const scoreQualified = item.buyScore >= buyThreshold;
  const scoreNear = item.buyScore >= buyThreshold * nearRatio;
  const checkDetail = failedCheckDetail(item);

  const qualityBlocked =
    item.blockedBy?.gate === 'quality' ||
    item.qualityBlocked === true ||
    (item.gateReasons ?? []).some((reason) => QUALITY_REASON.test(reason));

  let tier: NearMissTier;
  let detail: string;
  if (qualityBlocked) {
    tier = 'quality-blocked';
    detail =
      checkDetail ??
      '점수와 추세는 통과, 진입 품질 게이트(IBS·ATR%·상대강도·SMA50 풀백·점수 상한)에서 차단';
  } else if (trendOk && scoreQualified) {
    tier = 'gated';
    detail =
      checkDetail ??
      (item.blockedBy
        ? `차단 게이트: ${item.blockedBy.gate}`
        : '점수·추세 통과, 클러스터 필터 또는 지표 합치도에서 차단된 것으로 보임');
  } else if (trendOk && scoreNear) {
    tier = 'score-near';
    detail = `매수 점수 ${item.buyScore.toFixed(1)} / 기준 ${buyThreshold} (${Math.round(
      (item.buyScore / buyThreshold) * 100
    )}%)${rsOk ? ' · RS 통과' : ' · RS 미달'}`;
  } else if (trendOk && rsOk) {
    tier = 'trend-rs-ok';
    detail = `상승 추세 · 시장/섹터 상대강도 ≥ ${rsMin} · 매수 점수 ${item.buyScore.toFixed(1)} 부족`;
  } else if (trendOk) {
    tier = 'trend-ok';
    detail = components
      ? `상승 추세 · 상대강도 미달 (SPY ${components.rsSpy.toFixed(2)}, 섹터 ${components.rsSector.toFixed(2)} < ${rsMin})`
      : '상승 추세 · 상대강도 정보 없음';
  } else {
    tier = 'trend-fail';
    detail = `추세 게이트 미통과 (${item.gates?.trend?.regime ?? 'unknown'})`;
  }
  return { tier, rank: TIER_RANK[tier], label: TIER_LABEL[tier], detail };
}

/** Stable sort: closest tier first, then higher buy score, then ticker. */
export function sortByNearMiss<T extends StockScreenMatch>(
  items: T[],
  options: NearMissOptions = {}
): Array<{ item: T; info: NearMissTierInfo }> {
  return items
    .map((item) => ({ item, info: classifyNearMiss(item, options) }))
    .sort(
      (a, b) =>
        a.info.rank - b.info.rank ||
        b.item.buyScore - a.item.buyScore ||
        a.item.ticker.localeCompare(b.item.ticker)
    );
}
