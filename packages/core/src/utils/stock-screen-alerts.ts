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

/** Keep the original screening decisions and session dates while adding bounded report details. */
export async function buildStockScreenReportNotification(
  screen: StockScreenResult,
  dependencies?: Parameters<typeof buildStockReportWhatsAppNotification>[1]
): Promise<WhatsAppNotification> {
  const { coverage, criteria } = screen;
  const input: StockReportAlertInput = {
    title: `Stock Checker screen: ${criteria.decision} ${screen.status}`,
    asOf: `Scan completed ${screen.generatedAt}`,
    coverageSummary: `Status ${screen.status}; filter ${criteria.decision}; analyzed ${coverage.analyzed}/${coverage.requested}; matched ${coverage.matched}; unavailable ${coverage.unavailable}. Report returned ${coverage.returned}/${coverage.matched} matches, limit ${criteria.limit}, ${coverage.truncated ? 'truncated' : 'not truncated'}; alert shows ${Math.min(3, screen.matches.length)}/${coverage.returned} returned.`,
    lookbackDays: criteria.lookbackDays,
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
  const { coverage, criteria } = screen;
  const rows = candidates.map((candidate) => {
    const price = candidate.execution.reference?.price;
    const reference = price !== undefined && Number.isFinite(price) ? price.toFixed(2) : 'n/a';
    return `${oneLine(candidate.ticker, 32)} ${candidate.decision} bar ${oneLine(candidate.dataAsOf ?? 'n/a', 10)} reference ${reference}`;
  });
  const summary = [
    `Status ${screen.status}; filter ${criteria.decision}; analyzed ${coverage.analyzed}/${coverage.requested}; matched ${coverage.matched}; unavailable ${coverage.unavailable}.`,
    `Report returned ${coverage.returned}/${coverage.matched} matches, limit ${criteria.limit}, ${coverage.truncated ? 'truncated' : 'not truncated'}; alert shows ${candidates.length}/${coverage.returned} returned.`,
    'Scores are not probabilities of profit; completed-close references are not fills; bar dates vary by ticker.',
    `Candidates: ${rows.length ? rows.join('; ') : 'none'}.`,
  ].join(' ');
  return {
    title: oneLine(`Stock Checker screen: ${criteria.decision} ${screen.status}`, 80),
    asOf: oneLine(`Scan completed ${screen.generatedAt}`, 60),
    summary: oneLine(summary, 700),
  };
}
