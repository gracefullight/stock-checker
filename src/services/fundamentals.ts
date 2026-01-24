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
  marketCap: number | null;
}

export async function getFundamentals(ticker: string): Promise<FundamentalData> {
  try {
    const summary = await yahooFinance.quoteSummary(ticker, {
      modules: ['summaryDetail', 'price', 'calendarEvents'],
    });

    const summaryDetail = summary.summaryDetail;
    const price = summary.price;
    const calendarEvents = summary.calendarEvents;

    const nextEarningsDate =
      calendarEvents?.earnings?.earningsDate && calendarEvents.earnings.earningsDate.length > 0
        ? new Date(calendarEvents.earnings.earningsDate[0])
        : null;

    return {
      ticker,
      pe: summaryDetail?.trailingPE ?? null,
      dividendYield: summaryDetail?.trailingAnnualDividendYield ?? null,
      nextEarningsDate,
      marketCap: price?.marketCap ?? null,
    };
  } catch (error) {
    logger.error({ error, ticker }, 'Failed to fetch fundamentals');
    return {
      ticker,
      pe: null,
      dividendYield: null,
      nextEarningsDate: null,
      marketCap: null,
    };
  }
}
