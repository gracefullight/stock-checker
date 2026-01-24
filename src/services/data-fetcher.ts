import axios, { type AxiosRequestConfig, isAxiosError } from 'axios';
import { DateTime } from 'luxon';
import pino from 'pino';
import yahooFinance from '@/services/yahoo-finance';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
});

const axiosInstance = axios.create({
  timeout: 30000,
  maxRedirects: 5,
});

axiosInstance.interceptors.response.use(undefined, async (error) => {
  const config = error.config as AxiosRequestConfig & { __retryCount?: number };
  config.__retryCount = config.__retryCount ?? 0;

  if (config.__retryCount < 3 && shouldRetry(error)) {
    config.__retryCount++;
    const delay = 1000 * 2 ** (config.__retryCount - 1);
    await new Promise((r) => setTimeout(r, delay));
    return axiosInstance(config);
  }
  return Promise.reject(error);
});

function shouldRetry(error: unknown): boolean {
  if (isAxiosError(error)) {
    return !error.response || (error.response.status >= 500 && error.response.status < 600);
  }
  return false;
}

export async function getHistoricalPrices(symbol: string, daysAgo = 365) {
  const end = DateTime.now();
  const start = end.minus({ days: daysAgo });

  try {
    return await yahooFinance.historical(symbol, {
      period1: start.toJSDate(),
      period2: end.toJSDate(),
      interval: '1d',
      events: 'history',
      includeAdjustedClose: true,
    });
  } catch (error) {
    logger.error({ error, symbol }, 'Failed to fetch historical prices');
    return [];
  }
}

export async function getFearGreedIndex(): Promise<number | null> {
  try {
    const res = await axiosInstance.get('https://api.alternative.me/fng/?limit=1&format=json');
    const value = parseInt(res.data?.data?.[0]?.value, 10);
    return Number.isNaN(value) ? null : value;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch fear/greed index');
    return null;
  }
}
