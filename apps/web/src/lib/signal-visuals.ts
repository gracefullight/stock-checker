import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@stock-checker/core/src/constants';
import type { PipelineConfig } from '@stock-checker/core/src/types';

export type SignalDecision = 'BUY' | 'SELL' | 'HOLD';
export type SignalVisualState = 'buy' | 'sell' | 'blocked' | 'hold';
export type SignalTone = 'success' | 'destructive' | 'warning' | 'muted';

export interface SignalThresholds {
  buy: number;
  sell: number;
  /** Upper buy-score cap from the entry-quality gate; scores at or above it are HOLD. */
  scoreMax?: number;
}

/** Thresholds of the shipped leader-pullback configuration, used until a frozen config arrives. */
export const DEFAULT_SIGNAL_THRESHOLDS: SignalThresholds = {
  buy: DEFAULT_QUALITY_PIPELINE_CONFIG.thresholds.buy,
  sell: DEFAULT_QUALITY_PIPELINE_CONFIG.thresholds.sell,
  scoreMax: DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate.scoreMax,
};

export function signalThresholdsFromConfig(
  config: Partial<Pick<PipelineConfig, 'thresholds' | 'qualityGate'>> | null | undefined
): SignalThresholds {
  if (!config?.thresholds) return DEFAULT_SIGNAL_THRESHOLDS;
  return {
    buy: config.thresholds.buy,
    sell: config.thresholds.sell,
    scoreMax: config.qualityGate?.scoreMax ?? DEFAULT_SIGNAL_THRESHOLDS.scoreMax,
  };
}

export interface SignalVisual {
  state: SignalVisualState;
  tone: SignalTone;
  /** Short text that always accompanies the colour (never colour-only). */
  label: 'BUY' | 'SELL' | 'HOLD' | 'BLOCKED';
  /** Korean explanation of what the final decision means for this score. */
  description: string;
  /** Meter maximum derived from the frozen config cap, not an arbitrary number. */
  meterMax: number;
  /** Percent of the meter to fill (0..100). */
  pct: number;
  /** Whether the raw buy score alone would have qualified. */
  scoreQualified: boolean;
  /** Whether the score sits at or above the overextension cap. */
  overCap: boolean;
}

export function normalizeDecision(decision: string | null | undefined): SignalDecision {
  return decision === 'BUY' || decision === 'SELL' ? decision : 'HOLD';
}

const TONE: Record<SignalVisualState, SignalTone> = {
  buy: 'success',
  sell: 'destructive',
  blocked: 'warning',
  hold: 'muted',
};

const LABEL: Record<SignalVisualState, SignalVisual['label']> = {
  buy: 'BUY',
  sell: 'SELL',
  blocked: 'BLOCKED',
  hold: 'HOLD',
};

/**
 * Derive every score visual from the engine's final decision plus the frozen
 * thresholds. A HOLD whose buy score clears the threshold is a *blocked* setup
 * (trend, cluster, overextension or entry-quality gate) and must not look like
 * a strong BUY.
 */
export function deriveSignalVisual(input: {
  decision: string | null | undefined;
  score: number;
  buyScore?: number | null;
  thresholds?: SignalThresholds | null;
}): SignalVisual {
  const thresholds = input.thresholds ?? DEFAULT_SIGNAL_THRESHOLDS;
  const decision = normalizeDecision(input.decision);
  const buyScore = Number.isFinite(input.buyScore ?? Number.NaN)
    ? (input.buyScore as number)
    : input.score;
  const scoreQualified = buyScore >= thresholds.buy;
  const overCap = thresholds.scoreMax !== undefined && buyScore >= thresholds.scoreMax;
  const state: SignalVisualState =
    decision === 'BUY' ? 'buy' : decision === 'SELL' ? 'sell' : scoreQualified ? 'blocked' : 'hold';
  const meterMax = thresholds.scoreMax ?? thresholds.buy * 2;
  const pct = Math.min(100, Math.max(0, (input.score / meterMax) * 100));
  const rounded = Math.round(input.score);
  const description =
    state === 'buy'
      ? `엔진 최종 결정 BUY · 점수 ${rounded} (기준 ${thresholds.buy} 이상, 상한 ${meterMax} 미만) · 다음 세션 시가 진입 조건부`
      : state === 'sell'
        ? `보유자 청산 경고 · 매도 점수가 기준 ${thresholds.sell} 이상 · 공매도 추천 아님`
        : state === 'blocked'
          ? overCap
            ? `점수 ${rounded} ≥ 상한 ${meterMax}: 과열(추격) 구간으로 품질 게이트가 차단 → HOLD`
            : `점수 ${rounded} ≥ 기준 ${thresholds.buy} 이지만 추세·클러스터·진입 품질 게이트 중 하나가 차단 → HOLD`
          : `점수 ${rounded} < 기준 ${thresholds.buy} · 진입 없음`;
  return {
    state,
    tone: TONE[state],
    label: LABEL[state],
    description,
    meterMax,
    pct,
    scoreQualified,
    overCap,
  };
}

/** Tailwind text class for a tone; pair with a text label, never alone. */
export function toneTextClass(tone: SignalTone): string {
  switch (tone) {
    case 'success':
      return 'text-success';
    case 'destructive':
      return 'text-destructive';
    case 'warning':
      return 'text-warning';
    default:
      return 'text-muted-foreground';
  }
}

/** Left-border accent for table rows and cards. */
export function toneBorderClass(tone: SignalTone): string {
  switch (tone) {
    case 'success':
      return 'border-l-2 border-l-success';
    case 'destructive':
      return 'border-l-2 border-l-destructive';
    case 'warning':
      return 'border-l-2 border-l-warning';
    default:
      return 'border-l-2 border-l-transparent';
  }
}
