import { describe, expect, it } from 'vitest';
import type { PositionDigest, PositionDigestItem } from '@/positions/digest';
import type { PositionEntry } from '@/positions/ledger';
import {
  buildPositionPlan,
  positionTiming,
  resolvePositionSizing,
  VALIDATED_EXPECTATION,
} from '@/positions/plan';
import {
  formatPercent,
  formatPositionDigest,
  formatSessionLabel,
  formatSizingLine,
  formatSydneyTime,
} from '@/utils/position-alerts';

const MORNING = new Date('2026-10-06T22:00:00Z');

function entry(
  ticker: string,
  signalSession: string,
  extra: Partial<PositionEntry> = {}
): PositionEntry {
  return {
    schemaVersion: 1,
    key: `${ticker}:${signalSession}`,
    ticker,
    signalSession,
    source: { kind: 'manual', createdBy: 'cli' },
    validatedUniverse: true,
    inPlan: true,
    plan: buildPositionPlan(signalSession),
    reference: null,
    fill: null,
    close: null,
    createdAt: MORNING.toISOString(),
    updatedAt: MORNING.toISOString(),
    ...extra,
  };
}

function item(
  kind: PositionDigestItem['kind'],
  row: PositionEntry,
  extra: Partial<PositionDigestItem> = {}
): PositionDigestItem {
  return {
    entry: row,
    timing: positionTiming(row.plan, MORNING),
    kind,
    paper: null,
    actualReturnPct: null,
    sellSignal: false,
    ...extra,
  };
}

function digest(items: PositionDigestItem[], extra: Partial<PositionDigest> = {}): PositionDigest {
  return {
    generatedAt: MORNING.toISOString(),
    nextOpenSession: '2026-10-07',
    latestCompletedSession: '2026-10-06',
    items,
    excluded: [],
    sizing: resolvePositionSizing({ POSITIONS_CAPITAL: '10000' }),
    expectation: VALIDATED_EXPECTATION,
    warnings: [],
    ...extra,
  };
}

describe('position alert formatting helpers', () => {
  it('formats New York session labels and Sydney local times', () => {
    expect(formatSessionLabel('2026-10-07')).toBe('10-07(수)');
    expect(formatSessionLabel(null)).toBe('자료 없음');
    expect(formatSydneyTime('2026-10-07T13:30:00.000Z')).toBe('10-08 00:30');
    expect(formatSydneyTime('2026-11-27T18:00:00.000Z')).toBe('11-28 05:00');
    expect(formatPercent(1.234)).toBe('+1.23%');
    expect(formatPercent(-13.6, 1)).toBe('-13.6%');
    expect(formatPercent(null)).toBe('n/a');
  });
});

describe('formatPositionDigest', () => {
  it('renders the Korean 보유 계획 section with one block per ticker', () => {
    const text = formatPositionDigest(
      digest(
        [
          item(
            'exit-eve',
            entry('NVDA', '2026-09-30', {
              fill: { price: 123.45, size: 10, recordedAt: MORNING.toISOString(), note: null },
            })
          ),
          item('exit-passed', entry('AMD', '2026-09-29'), {
            paper: { status: 'completed', netReturnPct: 1.234, outcome: 'win' },
          }),
          item('entry', entry('AAPL', '2026-10-06')),
          item('holding', entry('TSLA', '2026-10-02'), { sellSignal: true }),
          item(
            'closed',
            entry('MSFT', '2026-09-28', {
              fill: { price: 100, size: 1, recordedAt: MORNING.toISOString(), note: null },
              close: {
                price: 102,
                session: '2026-10-06',
                recordedAt: MORNING.toISOString(),
                note: null,
              },
            }),
            { actualReturnPct: 2 }
          ),
        ],
        { excluded: [{ ticker: 'ZZZQ', signalSession: '2026-10-02', reason: '검증 범위 밖 종목' }] }
      )
    );
    expect(text).toBe(
      [
        '*보유 계획 · 다음 개장 10-07(수)*',
        '',
        '*NVDA · 오늘 밤 청산*',
        '4/5일차 · 청산 10-07(수) 종가 · 시드니 10-08 07:00',
        '체결 123.45 × 10주',
        '',
        '*AMD · 청산 확인 필요*',
        '계획 청산 10-06(화) 종가 경과 · 모의 손익 +1.23% (왕복 10bps)',
        '청산 기록 없음 · positions close로 기록',
        '',
        '*AAPL · 진입 예정*',
        '10-07(수) 시가 · 시드니 10-08 00:30',
        '청산 10-13(화) 종가 · 시드니 10-14 07:00',
        '',
        '*TSLA · 보유 중*',
        '2/5일차 · 청산 10-09(금) 종가 · 시드니 10-10 07:00',
        '참고(검증 규칙 외): 오늘 SELL 신호 · 계획 청산일 유지',
        '',
        '*MSFT · 청산 완료*',
        '10-06(화) 102.00 · 실현 +2.00%',
        '',
        '1종목 비중 20% · 자본 10,000 → 1종목 2,000 (최대 5종목)',
        '',
        '검증 기대치(표본 내 n=155): 승률 57.4% · 평균 +0.63% · 최악 -13.6%',
        '',
        '계획 제외: ZZZQ 2026-10-02 · 검증 범위 밖 종목',
      ].join('\n')
    );
    expect(text.length).toBeLessThan(700);
  });

  it('labels early closes and missing paper results explicitly', () => {
    const text = formatPositionDigest(
      digest([
        item('exit-eve', entry('AAPL', '2026-11-19')),
        item('exit-passed', entry('AMD', '2026-09-29'), {
          paper: { status: 'pending', netReturnPct: null, outcome: null },
        }),
      ])
    );
    expect(text).toContain('청산 11-27(금) 종가 (조기 폐장) · 시드니 11-28 05:00');
    expect(text).toContain('모의 손익 n/a');
    expect(text).not.toContain('1종목 비중');
    expect(formatSizingLine(resolvePositionSizing({}))).toBe(
      '1종목 비중 20% (최대 5종목 · POSITIONS_CAPITAL 미설정)'
    );
  });

  it('returns nothing without rows and drops low-priority blocks under a tight budget', () => {
    expect(formatPositionDigest(digest([]))).toBe('');
    const rows = digest([
      item('exit-eve', entry('NVDA', '2026-09-30')),
      item('holding', entry('TSLA', '2026-10-02')),
      item('holding', entry('AMD', '2026-10-02')),
    ]);
    const full = formatPositionDigest(rows);
    const tight = formatPositionDigest(rows, 160);
    expect(tight).toContain('*NVDA · 오늘 밤 청산*');
    expect(tight).not.toContain('*AMD · 보유 중*');
    expect(tight.endsWith('일부 보유 항목은 길이 제한으로 생략.')).toBe(true);
    expect(tight.length).toBeLessThanOrEqual(160);
    expect(formatPositionDigest(rows, 40)).toBe('');
    expect(full).toContain('*AMD · 보유 중*');
  });
});
