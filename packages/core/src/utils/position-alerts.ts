import { DateTime } from 'luxon';
import type { PositionDigest, PositionDigestItem } from '@/positions/digest';
import { type PositionSizing, SYDNEY_TIMEZONE, VALIDATED_EXPECTATION } from '@/positions/plan';
import { US_MARKET_TIMEZONE } from '@/utils/us-market-calendar';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const OMISSION = '일부 보유 항목은 길이 제한으로 생략.';

/** `10-13(화)` for a New York session date. */
export function formatSessionLabel(date: string | null): string {
  if (!date) return '자료 없음';
  const parsed = DateTime.fromISO(date, { zone: US_MARKET_TIMEZONE });
  if (!parsed.isValid) return '자료 없음';
  return `${parsed.toFormat('MM-dd')}(${WEEKDAYS[parsed.weekday - 1]})`;
}

/** `10-14 00:30` in Sydney local time for a UTC instant. */
export function formatSydneyTime(iso: string | null): string {
  if (!iso) return '자료 없음';
  const parsed = DateTime.fromISO(iso, { zone: SYDNEY_TIMEZONE });
  return parsed.isValid ? parsed.toFormat('MM-dd HH:mm') : '자료 없음';
}

export function formatPercent(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}%`;
}

function money(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(2);
}

function fillLine(item: PositionDigestItem): string | null {
  const fill = item.entry.fill;
  if (!fill) return null;
  return `체결 ${fill.price.toFixed(2)} × ${money(fill.size)}주`;
}

function exitLine(item: PositionDigestItem): string {
  const { plan } = item.entry;
  return `청산 ${formatSessionLabel(plan.exitSession)} 종가${plan.exitEarlyClose ? ' (조기 폐장)' : ''} · 시드니 ${formatSydneyTime(plan.exitCloseAt)}`;
}

function sellLine(item: PositionDigestItem): string | null {
  return item.sellSignal ? '참고(검증 규칙 외): 오늘 SELL 신호 · 계획 청산일 유지' : null;
}

function block(item: PositionDigestItem): string {
  const { entry, timing } = item;
  const lines: Array<string | null> = [];
  switch (item.kind) {
    case 'entry':
      lines.push(
        `*${entry.ticker} · 진입 예정*`,
        `${formatSessionLabel(entry.plan.entrySession)} 시가 · 시드니 ${formatSydneyTime(entry.plan.entryOpenAt)}`,
        exitLine(item),
        fillLine(item)
      );
      break;
    case 'exit-eve':
      lines.push(
        `*${entry.ticker} · 오늘 밤 청산*`,
        `${timing.dayCount}/5일차 · ${exitLine(item)}`,
        fillLine(item),
        sellLine(item)
      );
      break;
    case 'holding':
      lines.push(
        `*${entry.ticker} · 보유 중*`,
        `${timing.dayCount}/5일차 · ${exitLine(item)}`,
        fillLine(item),
        sellLine(item)
      );
      break;
    case 'exit-passed': {
      const paper = item.paper;
      const paperText =
        paper?.netReturnPct !== null && paper?.netReturnPct !== undefined
          ? `모의 손익 ${formatPercent(paper.netReturnPct)} (왕복 ${VALIDATED_EXPECTATION.costBpsRoundTrip}bps)`
          : '모의 손익 n/a';
      lines.push(
        `*${entry.ticker} · 청산 확인 필요*`,
        `계획 청산 ${formatSessionLabel(entry.plan.exitSession)} 종가 경과 · ${paperText}`,
        fillLine(item),
        '청산 기록 없음 · positions close로 기록'
      );
      break;
    }
    case 'closed': {
      const close = entry.close;
      lines.push(
        `*${entry.ticker} · 청산 완료*`,
        `${close ? `${formatSessionLabel(close.session)} ${close.price.toFixed(2)}` : '자료 없음'} · 실현 ${formatPercent(item.actualReturnPct)}${
          item.paper?.netReturnPct !== null && item.paper?.netReturnPct !== undefined
            ? ` · 모의 ${formatPercent(item.paper.netReturnPct)}`
            : ''
        }`
      );
      break;
    }
  }
  return lines.filter((line): line is string => Boolean(line)).join('\n');
}

export function formatSizingLine(sizing: PositionSizing): string {
  const weight = `${Number(sizing.weightPct.toFixed(1))}%`;
  return sizing.capital !== null && sizing.perPosition !== null
    ? `1종목 비중 ${weight} · 자본 ${money(sizing.capital)} → 1종목 ${money(Number(sizing.perPosition.toFixed(2)))} (최대 ${sizing.maxPositions}종목)`
    : `1종목 비중 ${weight} (최대 ${sizing.maxPositions}종목 · POSITIONS_CAPITAL 미설정)`;
}

export function formatExpectationLine(expectation: typeof VALIDATED_EXPECTATION): string {
  return `검증 기대치(표본 내 n=${expectation.samples}): 승률 ${expectation.winRatePct}% · 평균 ${formatPercent(expectation.meanNetReturnPct)} · 최악 ${formatPercent(expectation.worstNetReturnPct, 1)}`;
}

/**
 * Renders the '보유 계획' section within `budget` UTF-16 units, or '' when there is
 * nothing to show. Blocks are added in priority order (tonight's exit, overdue exits,
 * entries, holdings, recent closes, sizing, expectation, exclusions, warnings).
 */
export function formatPositionDigest(digest: PositionDigest, budget = 3000): string {
  if (!digest.items.length && !digest.excluded.length && !digest.warnings.length) return '';
  const heading = `*보유 계획 · 다음 개장 ${formatSessionLabel(digest.nextOpenSession)}*`;
  const blocks: string[] = digest.items.map(block);
  if (digest.items.some((item) => item.kind === 'entry'))
    blocks.push(formatSizingLine(digest.sizing));
  if (digest.items.length) blocks.push(formatExpectationLine(digest.expectation));
  if (digest.excluded.length) {
    blocks.push(
      `계획 제외: ${digest.excluded
        .slice(0, 5)
        .map((row) => `${row.ticker} ${row.signalSession}`)
        .join(
          ', '
        )}${digest.excluded.length > 5 ? ` 외 ${digest.excluded.length - 5}` : ''} · ${digest.excluded[0].reason}`
    );
  }
  for (const warning of digest.warnings) blocks.push(warning);
  const selected: string[] = [heading];
  let length = heading.length;
  let omitted = false;
  for (const candidate of blocks) {
    // Keep room for the omission marker even after a skip; a later, shorter block
    // must never consume the space the marker needs.
    const reserve = OMISSION.length + 2;
    if (length + 2 + candidate.length + reserve > budget) {
      omitted = true;
      continue;
    }
    selected.push(candidate);
    length += 2 + candidate.length;
  }
  if (omitted) {
    if (length + 2 + OMISSION.length > budget) return '';
    selected.push(OMISSION);
  }
  if (selected.length === 1) return '';
  return selected.join('\n\n');
}
