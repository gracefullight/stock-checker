import pino from 'pino';
import yahooFinance from '@/services/yahoo-finance';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
});

export interface EarningsEstimate {
  avg: number;
  low: number;
  high: number;
  yearAgoEps: number;
  numberOfAnalysts: number;
}

export interface EarningsActual {
  reportDate: Date;
  epsActual: number | null;
  epsEstimate: number | null;
  epsDifference: number | null;
  surprisePercent: number | null;
}

export interface EarningsTrend {
  endDate: Date;
  estimate: number;
  estimateAvg: number;
  estimateLow: number;
  estimateHigh: number;
  estimateCount: number;
  yearAgoEps: number;
}

export interface EarningsData {
  ticker: string;
  nextEarningsDate: Date | null;
  nextEarningsEstimate: EarningsEstimate | null;
  earningsHistory: EarningsActual[];
  earningsTrend: EarningsTrend[];
  currentQuarterEstimate: number | null;
  currentYearEstimate: number | null;
}

interface RawEarningsHistory {
  epsActual?: number;
  epsEstimate?: number;
  epsActualDate: string;
}

interface RawEarningsTrend {
  endDate: string;
  estimate: number;
  estimateAvg: number;
  estimateLow: number;
  estimateHigh: number;
  estimateCount: number;
  yearAgoEps: number;
}

export async function getEarningsData(ticker: string): Promise<EarningsData> {
  try {
    const summary = await yahooFinance.quoteSummary(ticker, {
      modules: ['earnings', 'earningsHistory', 'earningsTrend', 'calendarEvents'],
    });

    const history = summary.earningsHistory;
    const trend = summary.earningsTrend;
    const calendarEvents = summary.calendarEvents;

    const nextEarningsDate =
      calendarEvents?.earnings?.earningsDate && calendarEvents.earnings.earningsDate.length > 0
        ? new Date(calendarEvents.earnings.earningsDate[0])
        : null;

    const earningsHistory: EarningsActual[] = (
      (history?.history || []) as unknown as RawEarningsHistory[]
    ).map((h) => {
      const epsActual = h.epsActual ?? null;
      const epsEstimate = h.epsEstimate ?? null;
      return {
        reportDate: new Date(h.epsActualDate),
        epsActual,
        epsEstimate,
        epsDifference: epsActual !== null && epsEstimate !== null ? epsActual - epsEstimate : null,
        surprisePercent:
          epsActual !== null && epsEstimate !== null && epsEstimate !== 0
            ? ((epsActual - epsEstimate) / Math.abs(epsEstimate)) * 100
            : null,
      };
    });

    const earningsTrend: EarningsTrend[] = (
      (trend?.trend || []) as unknown as RawEarningsTrend[]
    ).map((t) => ({
      endDate: new Date(t.endDate),
      estimate: t.estimate,
      estimateAvg: t.estimateAvg,
      estimateLow: t.estimateLow,
      estimateHigh: t.estimateHigh,
      estimateCount: t.estimateCount,
      yearAgoEps: t.yearAgoEps,
    }));

    const nextEarningsEstimate =
      earningsTrend.length > 0
        ? {
            avg: earningsTrend[0].estimateAvg ?? earningsTrend[0].estimate,
            low: earningsTrend[0].estimateLow,
            high: earningsTrend[0].estimateHigh,
            yearAgoEps: earningsTrend[0].yearAgoEps,
            numberOfAnalysts: earningsTrend[0].estimateCount,
          }
        : null;

    const currentQuarterEstimate: number | null = null;
    const currentYearEstimate: number | null = null;

    return {
      ticker,
      nextEarningsDate,
      nextEarningsEstimate,
      earningsHistory,
      earningsTrend,
      currentQuarterEstimate,
      currentYearEstimate,
    };
  } catch (error) {
    logger.error({ error, ticker }, 'Failed to fetch earnings data');
    return {
      ticker,
      nextEarningsDate: null,
      nextEarningsEstimate: null,
      earningsHistory: [],
      earningsTrend: [],
      currentQuarterEstimate: null,
      currentYearEstimate: null,
    };
  }
}

export function calculateEarningsSurpriseAverage(history: EarningsActual[]): number {
  if (history.length === 0) return 0;

  const surprises = history
    .filter((h) => h.surprisePercent !== null)
    .map((h) => h.surprisePercent as number);

  if (surprises.length === 0) return 0;

  return surprises.reduce((sum, s) => sum + s, 0) / surprises.length;
}

export function formatEarningsData(data: EarningsData): string {
  const lines: string[] = [];

  lines.push(`\n=== Earnings Data for ${data.ticker} ===`);

  if (data.nextEarningsDate) {
    lines.push(`Next Earnings Date: ${data.nextEarningsDate.toISOString().split('T')[0]}`);

    if (data.nextEarningsEstimate) {
      const est = data.nextEarningsEstimate;
      lines.push(`Next Earnings Estimate:`);
      lines.push(`  Consensus (Avg): $${est.avg.toFixed(2)}`);
      lines.push(`  Range: $${est.low.toFixed(2)} - $${est.high.toFixed(2)}`);
      lines.push(`  Year Ago EPS: $${est.yearAgoEps.toFixed(2)}`);
      lines.push(`  Number of Analysts: ${est.numberOfAnalysts}`);
    }
  } else {
    lines.push('Next earnings date: Not available');
  }

  if (data.currentQuarterEstimate) {
    lines.push(`Current Quarter Estimate: $${data.currentQuarterEstimate.toFixed(2)}`);
  }

  if (data.currentYearEstimate) {
    lines.push(`Current Year Estimate: $${data.currentYearEstimate.toFixed(2)}`);
  }

  if (data.earningsHistory.length > 0) {
    lines.push(`\nEarnings History (last ${data.earningsHistory.length} quarters):`);

    const avgSurprise = calculateEarningsSurpriseAverage(data.earningsHistory);
    lines.push(`Average Surprise: ${avgSurprise.toFixed(2)}%`);

    data.earningsHistory.slice(0, 4).forEach((h) => {
      lines.push(`  ${h.reportDate.toISOString().split('T')[0]}:`);
      lines.push(
        `    Actual: $${h.epsActual?.toFixed(2) ?? 'N/A'} | Est: $${h.epsEstimate?.toFixed(2) ?? 'N/A'}`
      );
      if (h.surprisePercent !== null) {
        const surpriseEmoji = h.surprisePercent >= 0 ? '🟢' : '🔴';
        lines.push(`    Surprise: ${surpriseEmoji} ${h.surprisePercent.toFixed(2)}%`);
      }
    });
    if (data.earningsHistory.length > 4) {
      lines.push(`  ... and ${data.earningsHistory.length - 4} more`);
    }
  } else {
    lines.push('\nNo earnings history available.');
  }

  if (data.earningsTrend.length > 0) {
    lines.push(`\nEarnings Trend (future estimates):`);
    data.earningsTrend.slice(0, 4).forEach((t) => {
      lines.push(
        `  ${t.endDate.toISOString().split('T')[0]}: $${t.estimate.toFixed(2)} (avg: $${t.estimateAvg.toFixed(2)})`
      );
    });
    if (data.earningsTrend.length > 4) {
      lines.push(`  ... and ${data.earningsTrend.length - 4} more`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
