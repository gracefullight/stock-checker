import axios, { type AxiosRequestConfig, isAxiosError } from 'axios';
import { DateTime } from 'luxon';
import pino from 'pino';
import { fetchTiingoDaily, isTiingoConfigured } from '@/services/tiingo';
import yahooFinance, { fetchYahooDaily } from '@/services/yahoo-finance';
import type { BenchmarkCandle } from '@/types';

/**
 * Axios errors carry the full request config, including the Tiingo API token
 * in query params — censor it before it reaches log sinks (CI logs persist).
 */
export const LOG_REDACT_PATHS = ['error.config.params.token', 'err.config.params.token'];

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
  transport: {
    target: 'pino-pretty',
    options: process.env.MCP_LOG_STDERR === '1' ? { destination: 2 } : undefined,
  },
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

/** Why a provider chain produced no usable rows, after every fallback was tried. */
export type MarketDataFailureCause = 'rate-limited' | 'empty' | 'error';

export type HistoricalRow =
  | Awaited<ReturnType<typeof fetchYahooDaily>>[number]
  | Awaited<ReturnType<typeof fetchTiingoDaily>>[number];

export interface HistoricalPricesResult {
  rows: HistoricalRow[];
  /** Null when rows were returned; otherwise the most specific failure observed. */
  failure: MarketDataFailureCause | null;
}

/** Typed provider failure so callers can tell a 429 from an empty series. */
export class MarketDataError extends Error {
  readonly symbol: string;
  readonly failure: MarketDataFailureCause;

  constructor(symbol: string, failure: MarketDataFailureCause, cause?: unknown) {
    super(
      failure === 'rate-limited'
        ? `Market data provider rate-limited ${symbol}`
        : failure === 'empty'
          ? `Market data provider returned no rows for ${symbol}`
          : `Market data request failed for ${symbol}`,
      cause === undefined ? undefined : { cause }
    );
    // 'RateLimitError' is the name the screening pause detector recognizes.
    this.name = failure === 'rate-limited' ? 'RateLimitError' : 'MarketDataError';
    this.symbol = symbol;
    this.failure = failure;
  }
}

/** Classify a provider error; HTTP 429 and rate-limit wording count as rate-limited. */
export function classifyProviderError(error: unknown): MarketDataFailureCause {
  if (!error || typeof error !== 'object') return 'error';
  const value = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    name?: unknown;
    message?: unknown;
  };
  return value.status === 429 ||
    value.statusCode === 429 ||
    value.response?.status === 429 ||
    value.name === 'RateLimitError' ||
    (typeof value.message === 'string' &&
      /\b429\b|too many requests|rate.limit/i.test(value.message))
    ? 'rate-limited'
    : 'error';
}

/**
 * Yahoo first, then Tiingo when a key is provisioned. Never throws: the result
 * carries the failure cause so callers can report rate limits distinctly.
 */
export async function getHistoricalPricesDetailed(
  symbol: string,
  daysAgo = 365
): Promise<HistoricalPricesResult> {
  const end = DateTime.now();
  const start = end.minus({ days: daysAgo });
  let failure: MarketDataFailureCause = 'empty';

  try {
    const rows = await fetchYahooDaily(symbol, start.toJSDate(), end.toJSDate());
    if (rows.length > 0) return { rows, failure: null };
    logger.warn({ symbol }, 'Yahoo returned no historical prices');
  } catch (error) {
    failure = classifyProviderError(error);
    logger.error({ error, symbol, failure }, 'Failed to fetch historical prices from Yahoo');
  }

  // Fallback: Tiingo daily candles when a key is provisioned (Yahoo rate-limits
  // aggressively); without a key, degrade to [] as before.
  if (isTiingoConfigured()) {
    try {
      const rows = await fetchTiingoDaily(symbol, daysAgo);
      if (rows.length > 0) return { rows, failure: null };
      logger.warn({ symbol }, 'Tiingo returned no historical prices');
      if (failure !== 'rate-limited') failure = 'empty';
    } catch (error) {
      const tiingoFailure = classifyProviderError(error);
      logger.error({ error, symbol, failure: tiingoFailure }, 'Tiingo fallback failed');
      // A rate limit on either provider is the actionable cause.
      if (failure !== 'rate-limited') failure = tiingoFailure;
    }
  }
  return { rows: [], failure };
}

export async function getHistoricalPrices(symbol: string, daysAgo = 365) {
  return (await getHistoricalPricesDetailed(symbol, daysAgo)).rows;
}

const BENCHMARK_TTL_MS = 5 * 60 * 1_000;
const benchmarkCache = new Map<
  string,
  {
    candles: BenchmarkCandle[];
    expiresAt: number;
    calendarDate: string | null;
  }
>();
const benchmarkInFlight = new Map<
  string,
  Promise<{ candles: BenchmarkCandle[]; failure: MarketDataFailureCause | null }>
>();

export interface BenchmarkFetchOptions {
  /**
   * Throw a `MarketDataError` (with the failure cause) instead of returning []
   * when every provider failed. Decision paths use this so a missing benchmark
   * is reported as unavailable rather than evaluated as a HOLD.
   */
  strict?: boolean;
}

export async function fetchBenchmarkPrices(
  symbol: string,
  daysAgo = 730,
  options: BenchmarkFetchOptions = {}
): Promise<BenchmarkCandle[]> {
  const key = JSON.stringify([symbol, daysAgo]);
  const calendarDate = DateTime.now().setZone('America/New_York').toISODate();
  const cached = benchmarkCache.get(key);
  if (cached && cached.calendarDate === calendarDate && cached.expiresAt > Date.now()) {
    return cached.candles;
  }
  benchmarkCache.delete(key);
  let request = benchmarkInFlight.get(key);
  if (!request) {
    request = (async () => {
      const { rows, failure } = await getHistoricalPricesDetailed(symbol, daysAgo);
      const candles: BenchmarkCandle[] = rows.map((d) => ({
        date: d.date,
        // Adapters return coherent adjusted OHLC, or coherent raw OHLC when
        // adjustment fields are unavailable; never replace just the close.
        close: d.close,
        volume: d.volume,
        high: d.high,
        low: d.low,
      }));
      if (candles.length > 0) {
        benchmarkCache.set(key, {
          candles,
          calendarDate,
          expiresAt: Date.now() + BENCHMARK_TTL_MS,
        });
      }
      return { candles, failure };
    })();
    benchmarkInFlight.set(key, request);
  }
  try {
    const { candles, failure } = await request;
    if (options.strict && failure !== null) throw new MarketDataError(symbol, failure);
    return candles;
  } finally {
    benchmarkInFlight.delete(key);
  }
}

/** Alternative.me's index measures Bitcoin sentiment, not equity sentiment. */
export async function getFearGreedIndex(): Promise<number | null> {
  try {
    const res = await axiosInstance.get('https://api.alternative.me/fng/?limit=1&format=json');
    const raw = res.data?.data?.[0]?.value;
    if ((typeof raw !== 'string' && typeof raw !== 'number') || String(raw).trim() === '')
      return null;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch fear/greed index');
    return null;
  }
}

export interface QuoteSnapshot {
  name: string;
  marketCap: number | null;
  dayChangePct: number | null;
}

/**
 * Batch-fetch name + market cap + day change for a list of symbols in a single
 * quote() request. Non-critical: returns whatever resolves, {} on failure.
 */
export async function getQuoteSnapshots(symbols: string[]): Promise<Record<string, QuoteSnapshot>> {
  if (symbols.length === 0) return {};
  try {
    const quotes = await yahooFinance.quote(symbols);
    const list = Array.isArray(quotes) ? quotes : [quotes];
    const snapshots: Record<string, QuoteSnapshot> = {};
    for (const q of list) {
      if (q?.symbol) {
        snapshots[q.symbol] = {
          name: q.longName ?? q.shortName ?? q.symbol,
          marketCap: q.marketCap ?? null,
          dayChangePct: q.regularMarketChangePercent ?? null,
        };
      }
    }
    return snapshots;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch quote snapshots');
    return {};
  }
}

export async function getQuoteNames(symbols: string[]): Promise<Record<string, string>> {
  const snapshots = await getQuoteSnapshots(symbols);
  return Object.fromEntries(Object.entries(snapshots).map(([sym, s]) => [sym, s.name]));
}

export interface FxRate {
  /** ISO-4217 quote currency, e.g. 'KRW' for USD→KRW. */
  currency: string;
  /** Units of `currency` per 1 USD. */
  rate: number;
  prevClose: number | null;
  dayChangePct: number | null;
  /** Quote timestamp (ISO-8601), market time when Yahoo provides it. */
  asOf: string;
}

/**
 * USD→currency spot rate via Yahoo's FX quote symbols (`USDKRW=X`).
 * Returns null when the pair is unknown or the quote has no price.
 */
export async function getFxRate(currency: string): Promise<FxRate | null> {
  try {
    const result = await yahooFinance.quote(`USD${currency}=X`);
    const quote = Array.isArray(result) ? result[0] : result;
    const rate = quote?.regularMarketPrice;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
    const marketTime = quote.regularMarketTime;
    return {
      currency,
      rate,
      prevClose: quote.regularMarketPreviousClose ?? null,
      dayChangePct: quote.regularMarketChangePercent ?? null,
      asOf: (marketTime instanceof Date ? marketTime : new Date()).toISOString(),
    };
  } catch (error) {
    logger.error({ error, currency }, 'Failed to fetch FX rate');
    return null;
  }
}
