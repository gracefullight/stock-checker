import yahooFinance from 'yahoo-finance2';
import pino from 'pino';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' }
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
    const [quote] = await yahooFinance.quote(ticker, {
      fields: ['trailingPE', 'dividendYield', 'earningsTimestamp', 'marketCap']
    });

    return {
      ticker,
      pe: quote?.trailingPE ?? null,
      dividendYield: quote?.dividendYield ?? null,
      nextEarningsDate: quote?.earningsTimestamp ?? null,
      marketCap: quote?.marketCap ?? null,
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
