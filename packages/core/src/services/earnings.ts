import pino from 'pino';
import yahooFinance from '@/services/yahoo-finance';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
});

export interface EarningsEstimate {
  avg: number | null;
  low: number | null;
  high: number | null;
  yearAgoEps: number | null;
  numberOfAnalysts: number | null;
}

export interface EarningsActual {
  /** Legacy ordering date; standard Yahoo history supplies a fiscal-quarter date. */
  reportDate: Date;
  dateBasis?: 'reported' | 'fiscal-quarter';
  epsActual: number | null;
  epsEstimate: number | null;
  epsDifference: number | null;
  surprisePercent: number | null;
}

export interface EarningsTrend {
  endDate: Date;
  estimate: number | null;
  estimateAvg: number | null;
  estimateLow: number | null;
  estimateHigh: number | null;
  estimateCount: number | null;
  yearAgoEps: number | null;
}

export interface EstimateRevisions {
  up30: number | null;
  down30: number | null;
  current: number | null;
  thirtyDaysAgo: number | null;
  direction: 'up' | 'down' | 'flat' | null;
}

export interface EarningsData {
  ticker: string;
  nextEarningsDate: Date | null;
  nextEarningsEstimate: EarningsEstimate | null;
  earningsHistory: EarningsActual[];
  earningsTrend: EarningsTrend[];
  estimateRevisions: EstimateRevisions | null;
  currentQuarterEstimate: number | null;
  currentYearEstimate: number | null;
}

interface RawEarningsHistory {
  epsActual?: number | null;
  epsEstimate?: number | null;
  epsActualDate?: string | Date | null;
  quarter?: string | Date | null;
}

interface RawEarningsTrend {
  period?: string;
  endDate?: string | Date | null;
  earningsEstimate?: Partial<EarningsEstimate>;
  estimate?: number | null;
  estimateAvg?: number | null;
  estimateLow?: number | null;
  estimateHigh?: number | null;
  estimateCount?: number | null;
  yearAgoEps?: number | null;
  epsTrend?: {
    current?: number | null;
    '30daysAgo'?: number | null;
  };
  epsRevisions?: {
    upLast30days?: number | null;
    downLast30days?: number | null;
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function validCount(value: unknown): number | null {
  const count = finiteNumber(value);
  return count !== null && Number.isInteger(count) && count >= 0 ? count : null;
}

function validDate(value: unknown): Date | null {
  if (!(value instanceof Date) && (typeof value !== 'string' || value.trim() === '')) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function extractEarningsEstimate(trend: RawEarningsTrend): EarningsEstimate {
  const estimate = trend.earningsEstimate;
  return {
    avg: finiteNumber(estimate ? estimate.avg : (trend.estimateAvg ?? trend.estimate)),
    low: finiteNumber(estimate ? estimate.low : trend.estimateLow),
    high: finiteNumber(estimate ? estimate.high : trend.estimateHigh),
    yearAgoEps: finiteNumber(estimate ? estimate.yearAgoEps : trend.yearAgoEps),
    numberOfAnalysts: validCount(estimate ? estimate.numberOfAnalysts : trend.estimateCount),
  };
}

function extractEstimateRevisions(trend: RawEarningsTrend | undefined): EstimateRevisions | null {
  if (!trend || (!trend.epsTrend && !trend.epsRevisions)) return null;

  const current = finiteNumber(trend.epsTrend?.current);
  const thirtyDaysAgo = finiteNumber(trend.epsTrend?.['30daysAgo']);

  let direction: EstimateRevisions['direction'] = null;
  if (current !== null && thirtyDaysAgo !== null) {
    if (current > thirtyDaysAgo) direction = 'up';
    else if (current < thirtyDaysAgo) direction = 'down';
    else direction = 'flat';
  }

  return {
    up30: validCount(trend.epsRevisions?.upLast30days),
    down30: validCount(trend.epsRevisions?.downLast30days),
    current,
    thirtyDaysAgo,
    direction,
  };
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
      calendarEvents?.earnings?.earningsDate?.map(validDate).find((date) => date !== null) ?? null;

    const earningsHistory: EarningsActual[] = (
      (history?.history || []) as unknown as RawEarningsHistory[]
    )
      .flatMap((h): EarningsActual[] => {
        const publishedDate = validDate(h.epsActualDate);
        const reportDate = publishedDate ?? validDate(h.quarter);
        if (!reportDate) return [];
        const epsActual = finiteNumber(h.epsActual);
        const epsEstimate = finiteNumber(h.epsEstimate);
        const epsDifference =
          epsActual !== null && epsEstimate !== null ? finiteNumber(epsActual - epsEstimate) : null;
        return [
          {
            reportDate,
            // A quarter label cannot be used as a point-in-time release timestamp.
            dateBasis: publishedDate ? 'reported' : 'fiscal-quarter',
            epsActual,
            epsEstimate,
            epsDifference,
            surprisePercent:
              epsDifference !== null && epsEstimate !== null && epsEstimate !== 0
                ? finiteNumber((epsDifference / Math.abs(epsEstimate)) * 100)
                : null,
          },
        ];
      })
      .sort((a, b) => a.reportDate.getTime() - b.reportDate.getTime());

    const rawTrend = (trend?.trend || []) as unknown as RawEarningsTrend[];
    const currentQuarter = rawTrend.find((t) => t.period === '0q');
    const currentYear = rawTrend.find((t) => t.period === '0y');
    const estimateRevisions = extractEstimateRevisions(currentQuarter);

    const earningsTrend: EarningsTrend[] = rawTrend.flatMap((t): EarningsTrend[] => {
      const endDate = validDate(t.endDate);
      if (!endDate) return [];
      const estimate = extractEarningsEstimate(t);
      return [
        {
          endDate,
          estimate: estimate.avg,
          estimateAvg: estimate.avg,
          estimateLow: estimate.low,
          estimateHigh: estimate.high,
          estimateCount: estimate.numberOfAnalysts,
          yearAgoEps: estimate.yearAgoEps,
        },
      ];
    });

    const quarterEstimate = currentQuarter ? extractEarningsEstimate(currentQuarter) : null;
    const nextEarningsEstimate =
      quarterEstimate && Object.values(quarterEstimate).some((value) => value !== null)
        ? quarterEstimate
        : null;
    const currentQuarterEstimate = quarterEstimate?.avg ?? null;
    const currentYearEstimate = currentYear ? extractEarningsEstimate(currentYear).avg : null;

    return {
      ticker,
      nextEarningsDate,
      nextEarningsEstimate,
      earningsHistory,
      earningsTrend,
      estimateRevisions,
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
      estimateRevisions: null,
      currentQuarterEstimate: null,
      currentYearEstimate: null,
    };
  }
}

export function calculateEarningsSurpriseAverage(history: EarningsActual[]): number {
  if (history.length === 0) return 0;

  const surprises = history
    .map((h) => h.surprisePercent)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  if (surprises.length === 0) return 0;

  return surprises.reduce((sum, value) => sum + value / surprises.length, 0);
}

function formatEps(value: number | null): string {
  return value === null ? 'N/A' : `$${value.toFixed(2)}`;
}

export function formatEarningsData(data: EarningsData): string {
  const lines: string[] = [];

  lines.push(`\n=== Earnings Data for ${data.ticker} ===`);

  if (data.nextEarningsDate) {
    lines.push(`Next Earnings Date: ${data.nextEarningsDate.toISOString().split('T')[0]}`);

    if (data.nextEarningsEstimate) {
      const est = data.nextEarningsEstimate;
      lines.push(`Next Earnings Estimate:`);
      lines.push(`  Consensus (Avg): ${formatEps(est.avg)}`);
      lines.push(`  Range: ${formatEps(est.low)} - ${formatEps(est.high)}`);
      lines.push(`  Year Ago EPS: ${formatEps(est.yearAgoEps)}`);
      lines.push(`  Number of Analysts: ${est.numberOfAnalysts ?? 'N/A'}`);
    }
  } else {
    lines.push('Next earnings date: Not available');
  }

  if (data.currentQuarterEstimate !== null) {
    lines.push(`Current Quarter Estimate: $${data.currentQuarterEstimate.toFixed(2)}`);
  }

  if (data.currentYearEstimate !== null) {
    lines.push(`Current Year Estimate: $${data.currentYearEstimate.toFixed(2)}`);
  }

  if (data.earningsHistory.length > 0) {
    lines.push(`\nEarnings History (last ${data.earningsHistory.length} quarters):`);

    const avgSurprise = calculateEarningsSurpriseAverage(data.earningsHistory);
    const hasSurprises = data.earningsHistory.some(
      (row) => row.surprisePercent !== null && Number.isFinite(row.surprisePercent)
    );
    lines.push(`Average Surprise: ${hasSurprises ? `${avgSurprise.toFixed(2)}%` : 'N/A'}`);

    data.earningsHistory
      .slice(-4)
      .reverse()
      .forEach((h) => {
        const basis = h.dateBasis === 'fiscal-quarter' ? ' (quarter)' : '';
        lines.push(`  ${h.reportDate.toISOString().split('T')[0]}${basis}:`);
        lines.push(`    Actual: ${formatEps(h.epsActual)} | Est: ${formatEps(h.epsEstimate)}`);
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
        `  ${t.endDate.toISOString().split('T')[0]}: ${formatEps(t.estimate)} (avg: ${formatEps(t.estimateAvg)})`
      );
    });
    if (data.earningsTrend.length > 4) {
      lines.push(`  ... and ${data.earningsTrend.length - 4} more`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
