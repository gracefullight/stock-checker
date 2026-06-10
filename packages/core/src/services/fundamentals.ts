import pino from 'pino';
import yahooFinance from '@/services/yahoo-finance';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
});

export interface FundamentalData {
  ticker: string;
  pe: number | null;
  dividendYield: number | null;
  nextEarningsDate: Date | null;
  exDividendDate: Date | null;
  dividendDate: Date | null;
  marketCap: number | null;
  sector: string | null;
}

export async function getFundamentals(ticker: string): Promise<FundamentalData> {
  try {
    const summary = await yahooFinance.quoteSummary(ticker, {
      modules: ['summaryDetail', 'price', 'calendarEvents', 'summaryProfile'],
    });

    const summaryDetail = summary.summaryDetail;
    const price = summary.price;
    const calendarEvents = summary.calendarEvents;
    const profile = (summary as Record<string, unknown>).summaryProfile as
      | { sector?: string }
      | null
      | undefined;

    const nextEarningsDate =
      calendarEvents?.earnings?.earningsDate && calendarEvents.earnings.earningsDate.length > 0
        ? new Date(calendarEvents.earnings.earningsDate[0])
        : null;

    return {
      ticker,
      pe: summaryDetail?.trailingPE ?? null,
      dividendYield: summaryDetail?.trailingAnnualDividendYield ?? null,
      nextEarningsDate,
      exDividendDate: calendarEvents?.exDividendDate
        ? new Date(calendarEvents.exDividendDate)
        : null,
      dividendDate: calendarEvents?.dividendDate ? new Date(calendarEvents.dividendDate) : null,
      marketCap: price?.marketCap ?? null,
      sector: profile?.sector ?? null,
    };
  } catch (error) {
    logger.error({ error, ticker }, 'Failed to fetch fundamentals');
    return {
      ticker,
      pe: null,
      dividendYield: null,
      nextEarningsDate: null,
      exDividendDate: null,
      dividendDate: null,
      marketCap: null,
      sector: null,
    };
  }
}
