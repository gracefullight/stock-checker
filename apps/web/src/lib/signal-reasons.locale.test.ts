import type { TickerResult } from '@stock-checker/core/src/types';
import { describe, expect, it } from 'vitest';
import {
  describeBlock,
  describeTickerDecision,
  reasonCodeOf,
  translateGateReason,
} from '@/lib/signal-reasons.locale';
import { DEFAULT_SIGNAL_THRESHOLDS } from '@/lib/signal-visuals';

describe('translateGateReason', () => {
  it('translates every engine sentence by reason code', () => {
    const cases: Array<[string, string, string]> = [
      ['BUY trend gate: Upward trend; passed.', 'trend-gate', '추세 게이트: 상승 추세 · 통과'],
      [
        'BUY score 212.50 / threshold 200; SELL score 12.00 / threshold 130.',
        'score-threshold',
        '매수 점수 212.5 / 기준 200 · 매도 점수 12.0 / 기준 130',
      ],
      ['Confluence: 5/6; passed.', 'confluence', '지표 합치도 5/6 · 통과'],
      [
        'Reversal: rejected; trigger none / not evaluated.',
        'reversal',
        '반전 확인: 미확인 · 트리거 없음 / 미평가 (이 전략에서는 비활성)',
      ],
      [
        'Institutional score 0.812; passed. The institutional strategy blends this score into BUY scoring.',
        'institutional',
        '기관 수급 점수 0.812 · 기준 이상 (매수 점수에 블렌딩되는 참고 지표, 단독 게이트 아님)',
      ],
      [
        'The entry-quality gate rejected this score-qualified BUY setup.',
        'quality-blocked',
        '진입 품질 게이트가 점수 통과 BUY 셋업을 차단했습니다 (풀백 조건 미충족 또는 과열)',
      ],
      [
        'No entry: the complete BUY path did not pass or neither eligible decision qualified.',
        'hold-no-entry',
        '진입 없음: BUY 경로를 모두 통과하지 못했거나 어떤 결정도 기준을 충족하지 않음',
      ],
      [
        'SELL is a long-holder exit warning, not a short-entry recommendation.',
        'sell-exit-warning',
        'SELL은 보유자 청산 경고이며 공매도 진입 추천이 아닙니다',
      ],
      [
        'BUY qualifies at the completed close; execution remains conditional on the next session open.',
        'buy-conditional',
        '완료된 종가 기준 BUY 충족 · 실제 진입은 다음 세션 시가에 조건부',
      ],
    ];
    for (const [english, code, korean] of cases) {
      expect(reasonCodeOf(english)).toBe(code);
      expect(translateGateReason(english)).toBe(korean);
    }
  });

  it('passes unknown sentences through unchanged', () => {
    expect(translateGateReason('Completed-session engine evidence.')).toBe(
      'Completed-session engine evidence.'
    );
    expect(reasonCodeOf('Completed-session engine evidence.')).toBeNull();
  });
});

describe('describeBlock', () => {
  it('names the gate and lists failed checks with values and limits first', () => {
    const lines = describeBlock({
      gate: 'quality',
      checks: [
        { id: 'rsSpy', passed: true, value: 0.9, limit: 0.7, comparator: '>=' },
        { id: 'ibs', passed: false, value: 0.45, limit: 0.2, comparator: '<' },
        { id: 'belowSma50', passed: false },
      ],
      nextEligibleDate: '2026-10-20',
    });
    expect(lines[0]).toBe('차단 게이트: 진입 품질 게이트 (풀백)');
    expect(lines[1]).toBe('IBS (종가 위치): 0.45 < 한도 0.20 → 실패');
    expect(lines[2]).toBe('SMA50 아래 풀백: 실패');
    expect(lines[3]).toBe('시장 대비 상대강도: 0.90 >= 한도 0.70 → 통과');
    expect(lines.at(-1)).toBe('재진입 가능일: 2026-10-20');
  });
});

describe('describeTickerDecision', () => {
  const base = {
    ticker: 'AAA',
    score: 320,
    opinion: 'HOLD',
    trendRegime: 'uptrend',
    institutionalScore: 0.8,
    institutionalPassed: true,
    confluenceRatio: 0.83,
  } as unknown as TickerResult;

  it('explains a blocked HOLD from existing result fields when nothing structured is present', () => {
    const lines = describeTickerDecision(base, DEFAULT_SIGNAL_THRESHOLDS);
    expect(lines[0]).toContain('점수 320 ≥ 기준 200');
    expect(lines).toContainEqual('추세 게이트: 상승 추세 · 통과');
    expect(lines.some((line) => line.includes('클러스터 필터 또는 진입 품질 게이트'))).toBe(true);
  });

  it('prefers a structured blocker over string reasons', () => {
    const lines = describeTickerDecision(
      {
        ...base,
        blockedBy: { gate: 'cluster', lastSetupDate: '2026-10-08' },
        gateReasons: ['BUY trend gate: Upward trend; passed.'],
      },
      DEFAULT_SIGNAL_THRESHOLDS
    );
    expect(lines).toContain('차단 게이트: 클러스터 필터 (최근 BUY 이후 재진입 제한)');
    expect(lines).toContain('최근 셋업 소비일: 2026-10-08');
    expect(lines).not.toContain('추세 게이트: 상승 추세 · 통과');
  });

  it('translates string reasons when the API sends them', () => {
    const lines = describeTickerDecision(
      { ...base, opinion: 'BUY', score: 250, gateReasons: ['Confluence: 5/6; passed.'] },
      DEFAULT_SIGNAL_THRESHOLDS
    );
    expect(lines).toContain('지표 합치도 5/6 · 통과');
  });
});
