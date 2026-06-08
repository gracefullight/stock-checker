import { DateTime } from 'luxon';
import pino from 'pino';
import yahooFinance from '@/services/yahoo-finance';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
});

export interface DividendPayment {
  date: Date;
  amount: number;
}

export interface DividendSummary {
  ticker: string;
  dividendYield: number | null;
  payoutRatio: number | null;
  annualDividendRate: number | null;
  trailingAnnualDividendYield: number | null;
  lastDividendDate: Date | null;
  nextDividendDate: Date | null;
  dividendHistory: DividendPayment[];
}

interface RawDividend {
  date: Date | string;
  dividends: number;
}

export async function getDividendInfo(ticker: string, daysAgo = 365): Promise<DividendSummary> {
  try {
    const end = DateTime.now();
    const start = end.minus({ days: daysAgo });

    const summary = await yahooFinance.quoteSummary(ticker, {
      modules: ['summaryDetail'],
    });

    const dividendHistoryData = await yahooFinance.historical(ticker, {
      period1: start.toJSDate(),
      period2: end.toJSDate(),
      interval: '1d',
      events: 'dividends',
    });

    const summaryDetail = summary.summaryDetail;

    const dividendHistory: DividendPayment[] = (
      (dividendHistoryData || []) as unknown as RawDividend[]
    )
      .filter((d) => d.dividends !== null && d.dividends !== undefined)
      .map((d) => ({
        date: new Date(d.date),
        amount: d.dividends,
      }));

    const lastDividendDate = dividendHistory.length > 0 ? dividendHistory[0].date : null;

    return {
      ticker,
      dividendYield: summaryDetail?.trailingAnnualDividendYield ?? null,
      payoutRatio: summaryDetail?.payoutRatio ?? null,
      annualDividendRate: summaryDetail?.dividendRate ?? null,
      trailingAnnualDividendYield: summaryDetail?.trailingAnnualDividendYield ?? null,
      lastDividendDate,
      nextDividendDate: null,
      dividendHistory,
    };
  } catch (error) {
    logger.error({ error, ticker }, 'Failed to fetch dividend info');
    return {
      ticker,
      dividendYield: null,
      payoutRatio: null,
      annualDividendRate: null,
      trailingAnnualDividendYield: null,
      lastDividendDate: null,
      nextDividendDate: null,
      dividendHistory: [],
    };
  }
}

export function calculateAnnualizedDividend(dividendHistory: DividendPayment[]): number {
  if (dividendHistory.length === 0) return 0;

  const totalDividends = dividendHistory.reduce((sum, d) => sum + d.amount, 0);
  const firstPayment = dividendHistory[dividendHistory.length - 1].date;
  const lastPayment = dividendHistory[0].date;

  const daysBetween = Math.floor(
    (lastPayment.getTime() - firstPayment.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysBetween === 0) return totalDividends;

  const dailyRate = totalDividends / daysBetween;
  return dailyRate * 365;
}

export function formatDividendInfo(data: DividendSummary): string {
  const lines: string[] = [];

  lines.push(`\n=== Dividend Information for ${data.ticker} ===`);

  if (data.dividendYield !== null) {
    lines.push(`Dividend Yield: ${(data.dividendYield * 100).toFixed(2)}%`);
  }

  if (data.annualDividendRate !== null) {
    lines.push(`Annual Dividend Rate: $${data.annualDividendRate.toFixed(2)}`);
  }

  if (data.trailingAnnualDividendYield !== null) {
    lines.push(
      `Trailing Annual Dividend Yield: ${(data.trailingAnnualDividendYield * 100).toFixed(2)}%`
    );
  }

  if (data.payoutRatio !== null) {
    lines.push(`Payout Ratio: ${(data.payoutRatio * 100).toFixed(2)}%`);
  }

  if (data.lastDividendDate) {
    lines.push(`Last Dividend Date: ${data.lastDividendDate.toISOString().split('T')[0]}`);
  }

  if (data.dividendHistory.length > 0) {
    lines.push(`\nRecent Dividend Payments (${data.dividendHistory.length}):`);
    data.dividendHistory.slice(0, 5).forEach((d) => {
      lines.push(`  ${d.date.toISOString().split('T')[0]}: $${d.amount.toFixed(2)}`);
    });
    if (data.dividendHistory.length > 5) {
      lines.push(`  ... and ${data.dividendHistory.length - 5} more`);
    }

    const annualized = calculateAnnualizedDividend(data.dividendHistory);
    lines.push(`\nAnnualized Dividend (based on history): $${annualized.toFixed(2)}`);
  } else {
    lines.push('\nNo recent dividend payments found.');
  }

  lines.push('');
  return lines.join('\n');
}
