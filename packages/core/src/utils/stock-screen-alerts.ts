import type { StockScreenResult } from '@/reports/stock-screen';
import {
  formatScreenDecision,
  formatScreenEvaluation,
  formatScreeningOutcome,
  formatScreenTimestamp,
  type ScreeningNotificationContext,
} from '@/utils/screening-diagnostics';
import {
  buildStockReportWhatsAppNotification,
  formatStockReportWhatsAppNotification,
  type StockReportAlertInput,
} from '@/utils/stock-report-alerts';
import { sanitizeNotificationText, type WhatsAppNotification } from '@/utils/whatsapp';

export { formatScreenTimestamp };

const oneLine = (value: string, maximumLength: number) =>
  sanitizeNotificationText(value, maximumLength);

function screenEvaluation(screen: StockScreenResult): string {
  return formatScreenEvaluation({ total: screen.coverage.requested, ...screen.coverage });
}

function screenContext(screen: StockScreenResult): ScreeningNotificationContext {
  return {
    decision: screen.criteria.decision,
    analyzed: screen.coverage.analyzed,
    matched: screen.coverage.matched,
    unavailable: screen.unavailable,
  };
}

function screenTitle(screen: StockScreenResult): string {
  const decision = formatScreenDecision({
    ...screenContext(screen),
    total: screen.coverage.requested,
  });
  return `종목 스크리닝 · ${decision} · ${screenEvaluation(screen)}`;
}

/** Keep the original screening decisions and session dates while adding bounded report details. */
export async function buildStockScreenReportNotification(
  screen: StockScreenResult,
  dependencies?: Parameters<typeof buildStockReportWhatsAppNotification>[1]
): Promise<WhatsAppNotification> {
  const { criteria } = screen;
  const input: StockReportAlertInput = {
    title: screenTitle(screen),
    asOf: `검색 완료 ${formatScreenTimestamp(screen.generatedAt)}`,
    lookbackDays: criteria.lookbackDays,
    pipelineConfig: criteria.pipelineConfig,
    screening: screenContext(screen),
    universeSource:
      screen.universe.source === 'default-screener' ? 'configured-universe' : undefined,
    matchedTickers: screen.matches.map((candidate) => candidate.ticker),
    candidates: screen.matches.map((candidate) => ({
      ticker: candidate.ticker,
      decision: candidate.decision,
      dataAsOf: candidate.dataAsOf,
      gateReasons: candidate.gateReasons,
      gates: candidate.gates,
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

/** Compact MCP summary: a scan completion timestamp is separate from each candidate's bar date. */
export function buildStockScreenWhatsAppNotification(
  screen: StockScreenResult
): WhatsAppNotification {
  const candidates = screen.matches.slice(0, 3);
  const rows = candidates.map((candidate) => {
    const price = candidate.execution.reference?.price;
    const reference =
      price !== undefined && Number.isFinite(price) ? price.toFixed(2) : '자료 없음';
    return `${oneLine(candidate.ticker, 32)} ${candidate.decision} · 종가일 ${oneLine(candidate.dataAsOf ?? '자료 없음', 10)} · 참고 ${reference}`;
  });
  const outcome = formatScreeningOutcome(screenContext(screen));
  const diagnostics = outcome.split('\n').slice(1).join('\n');
  const rowBudget = rows.length
    ? Math.floor((700 - (diagnostics ? diagnostics.length + 1 : 0) - rows.length + 1) / rows.length)
    : 0;
  const summary = rows.length
    ? [...rows.map((row) => oneLine(row, rowBudget)), ...(diagnostics ? [diagnostics] : [])].join(
        '\n'
      )
    : outcome;
  return {
    title: oneLine(screenTitle(screen), 80),
    asOf: oneLine(`검색 완료 ${formatScreenTimestamp(screen.generatedAt)}`, 60),
    summary: summary.slice(0, 700).toWellFormed(),
  };
}
