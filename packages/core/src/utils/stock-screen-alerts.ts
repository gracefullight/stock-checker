import type { StockScreenResult } from '@/reports/stock-screen';
import {
  buildStockReportWhatsAppNotification,
  formatStockReportWhatsAppNotification,
  type StockReportAlertInput,
} from '@/utils/stock-report-alerts';
import type { WhatsAppNotification } from '@/utils/whatsapp';

function oneLine(value: string, maximumLength: number): string {
  return value
    .toWellFormed()
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu, ' ')
    .trim()
    .slice(0, maximumLength)
    .toWellFormed()
    .trimEnd();
}

function screenStatus(status: StockScreenResult['status']): string {
  return status === 'available' ? '완료' : status === 'partial' ? '일부 누락' : '자료 없음';
}

/** Display a known UTC instant to minute precision without using the host timezone. */
export function formatScreenTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    return value;
  }
  return `${value.slice(0, 10)} ${value.slice(11, 16)} UTC`;
}

function screenCoverage(screen: StockScreenResult): string {
  const { coverage, criteria } = screen;
  return [
    `필터 ${criteria.decision} · 분석 ${coverage.analyzed}/${coverage.requested} · 일치 ${coverage.matched} · 자료 없음 ${coverage.unavailable}`,
    `반환 ${coverage.returned}/${coverage.matched} · 제한 ${criteria.limit} · ${coverage.truncated ? '일부 생략' : '생략 없음'} · 알림 ${Math.min(3, screen.matches.length)}/${coverage.returned}개`,
  ].join('\n');
}

/** Keep the original screening decisions and session dates while adding bounded report details. */
export async function buildStockScreenReportNotification(
  screen: StockScreenResult,
  dependencies?: Parameters<typeof buildStockReportWhatsAppNotification>[1]
): Promise<WhatsAppNotification> {
  const { criteria } = screen;
  const input: StockReportAlertInput = {
    title: `종목 스크리닝 · ${criteria.decision} · ${screenStatus(screen.status)}`,
    asOf: `검색 완료 ${formatScreenTimestamp(screen.generatedAt)}`,
    coverageSummary: screenCoverage(screen),
    lookbackDays: criteria.lookbackDays,
    pipelineConfig: criteria.pipelineConfig,
    candidates: screen.matches.map((candidate) => ({
      ticker: candidate.ticker,
      decision: candidate.decision,
      dataAsOf: candidate.dataAsOf,
      gateReasons: candidate.gateReasons,
      reference: candidate.execution.reference,
    })),
  };
  // A timed-out scan can still have two provider requests in progress. Do not
  // start another data load until those calls finish; keep its saved snapshot.
  if (
    screen.unavailable.some(
      (item) =>
        item.reason === 'Screen time budget exhausted while ticker analysis was in progress.'
    )
  ) {
    return formatStockReportWhatsAppNotification(input, []);
  }
  return buildStockReportWhatsAppNotification(input, dependencies);
}

/** A scan completion timestamp is separate from each candidate's completed bar date. */
export function buildStockScreenWhatsAppNotification(
  screen: StockScreenResult
): WhatsAppNotification {
  const candidates = screen.matches.slice(0, 3);
  const { criteria } = screen;
  const rows = candidates.map((candidate) => {
    const price = candidate.execution.reference?.price;
    const reference =
      price !== undefined && Number.isFinite(price) ? price.toFixed(2) : '자료 없음';
    return `${oneLine(candidate.ticker, 32)} ${candidate.decision} · 종가일 ${oneLine(candidate.dataAsOf ?? '자료 없음', 10)} · 참고 ${reference}`;
  });
  const summary = rows.length ? rows.join('\n') : '일치 종목 없음.';
  return {
    title: oneLine(`종목 스크리닝 · ${criteria.decision} · ${screenStatus(screen.status)}`, 80),
    asOf: oneLine(`검색 완료 ${formatScreenTimestamp(screen.generatedAt)}`, 60),
    summary: summary.slice(0, 700).toWellFormed(),
  };
}
