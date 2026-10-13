import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/yahoo-finance', () => ({
  default: { quote: vi.fn() },
  fetchYahooDaily: vi.fn(),
}));
vi.mock('@/services/tiingo', () => ({
  isTiingoConfigured: vi.fn(),
  fetchTiingoDaily: vi.fn(),
}));

import {
  classifyProviderError,
  fetchBenchmarkPrices,
  getHistoricalPrices,
  getHistoricalPricesDetailed,
  MarketDataError,
} from '@/services/data-fetcher';
import { fetchTiingoDaily, isTiingoConfigured } from '@/services/tiingo';
import { fetchYahooDaily } from '@/services/yahoo-finance';

const mockedHistorical = vi.mocked(fetchYahooDaily);
const mockedIsConfigured = vi.mocked(isTiingoConfigured);
const mockedFetchTiingo = vi.mocked(fetchTiingoDaily);

const yahooRow = {
  date: new Date('2026-06-09'),
  open: 100,
  high: 105,
  low: 99,
  close: 104,
  adjClose: 104,
  volume: 1_000_000,
};

const tiingoRow = { ...yahooRow, close: 200 };

describe('getHistoricalPrices fallback chain', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns Yahoo data without touching Tiingo when Yahoo succeeds', async () => {
    mockedHistorical.mockResolvedValue([yahooRow] as never);

    const rows = await getHistoricalPrices('AAPL', 30);

    expect(rows).toHaveLength(1);
    expect(rows[0].close).toBe(104);
    expect(mockedFetchTiingo).not.toHaveBeenCalled();
  });

  it('falls back to Tiingo when Yahoo throws and a key is configured', async () => {
    mockedHistorical.mockRejectedValue(new Error('429'));
    mockedIsConfigured.mockReturnValue(true);
    mockedFetchTiingo.mockResolvedValue([tiingoRow] as never);

    const rows = await getHistoricalPrices('AAPL', 30);

    expect(mockedFetchTiingo).toHaveBeenCalledWith('AAPL', 30);
    expect(rows[0].close).toBe(200);
  });

  it('falls back to Tiingo when Yahoo returns an empty array', async () => {
    mockedHistorical.mockResolvedValue([] as never);
    mockedIsConfigured.mockReturnValue(true);
    mockedFetchTiingo.mockResolvedValue([tiingoRow] as never);

    const rows = await getHistoricalPrices('AAPL', 30);

    expect(rows).toHaveLength(1);
  });

  it('returns [] when Yahoo fails and no Tiingo key is configured', async () => {
    mockedHistorical.mockRejectedValue(new Error('429'));
    mockedIsConfigured.mockReturnValue(false);

    const rows = await getHistoricalPrices('AAPL', 30);

    expect(rows).toEqual([]);
    expect(mockedFetchTiingo).not.toHaveBeenCalled();
  });

  it('returns [] when both Yahoo and Tiingo fail', async () => {
    mockedHistorical.mockRejectedValue(new Error('429'));
    mockedIsConfigured.mockReturnValue(true);
    mockedFetchTiingo.mockRejectedValue(new Error('quota'));

    const rows = await getHistoricalPrices('AAPL', 30);

    expect(rows).toEqual([]);
  });

  it('keeps short and long benchmark windows separate', async () => {
    mockedHistorical
      .mockResolvedValueOnce([yahooRow])
      .mockResolvedValueOnce([{ ...yahooRow, date: new Date('2025-01-01') }, yahooRow]);

    expect(await fetchBenchmarkPrices('WINDOW', 30)).toHaveLength(1);
    expect(await fetchBenchmarkPrices('WINDOW', 730)).toHaveLength(2);

    expect(mockedHistorical).toHaveBeenCalledTimes(2);
  });

  it('retains a coherent price range when adjustment metadata is absent', async () => {
    mockedHistorical.mockResolvedValue([{ ...yahooRow, adjClose: 52 }]);

    const [row] = await fetchBenchmarkPrices('COHERENT');

    expect(row).toMatchObject({ close: 104, high: 105, low: 99 });
  });

  it('retries benchmarks after an empty upstream result', async () => {
    mockedHistorical.mockResolvedValueOnce([]).mockResolvedValueOnce([yahooRow]);

    expect(await fetchBenchmarkPrices('RECOVERY')).toEqual([]);
    expect(await fetchBenchmarkPrices('RECOVERY')).toHaveLength(1);
    expect(mockedHistorical).toHaveBeenCalledTimes(2);
  });

  it('refreshes a benchmark when the trading calendar day changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-09T03:59:00Z'));
    mockedHistorical.mockResolvedValue([yahooRow]);

    await fetchBenchmarkPrices('DAILY');
    vi.setSystemTime(new Date('2026-06-09T04:01:00Z'));
    await fetchBenchmarkPrices('DAILY');

    expect(mockedHistorical).toHaveBeenCalledTimes(2);
  });

  it('expires benchmarks during the same day so a newly closed session becomes available', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-09T19:55:00Z'));
    mockedHistorical.mockResolvedValue([yahooRow]);

    await fetchBenchmarkPrices('SESSION');
    vi.setSystemTime(new Date('2026-06-09T20:05:00Z'));
    await fetchBenchmarkPrices('SESSION');

    expect(mockedHistorical).toHaveBeenCalledTimes(2);
  });

  it('shares concurrent benchmark requests without duplicating upstream calls', async () => {
    mockedHistorical.mockResolvedValue([yahooRow]);

    const rows = await Promise.all([
      fetchBenchmarkPrices('CONCURRENT'),
      fetchBenchmarkPrices('CONCURRENT'),
    ]);

    expect(rows[0]).toEqual(rows[1]);
    expect(mockedHistorical).toHaveBeenCalledTimes(1);
  });
});

describe('strict benchmark fetches', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('throws a typed rate-limit error after Yahoo 429 and the Tiingo fallback both fail', async () => {
    mockedHistorical.mockRejectedValue(
      Object.assign(new Error('Too Many Requests'), { status: 429 })
    );
    mockedIsConfigured.mockReturnValue(true);
    mockedFetchTiingo.mockRejectedValue(new Error('quota'));

    const error = await fetchBenchmarkPrices('LIMITED', 730, { strict: true }).catch((e) => e);
    expect(error).toBeInstanceOf(MarketDataError);
    expect(error).toMatchObject({
      name: 'RateLimitError',
      symbol: 'LIMITED',
      failure: 'rate-limited',
    });
    // Non-strict callers keep the legacy empty-series contract.
    expect(await fetchBenchmarkPrices('LIMITED', 730)).toEqual([]);
  });

  it('distinguishes an empty series from a provider error', async () => {
    mockedHistorical.mockResolvedValue([] as never);
    mockedIsConfigured.mockReturnValue(false);
    await expect(fetchBenchmarkPrices('EMPTY', 730, { strict: true })).rejects.toMatchObject({
      failure: 'empty',
      name: 'MarketDataError',
    });

    mockedHistorical.mockRejectedValue(new Error('socket hang up'));
    await expect(fetchBenchmarkPrices('BROKEN', 730, { strict: true })).rejects.toMatchObject({
      failure: 'error',
    });
    expect(await getHistoricalPricesDetailed('BROKEN', 30)).toEqual({ rows: [], failure: 'error' });
  });

  it('classifies 429 responses and rate-limit wording as rate-limited', () => {
    expect(classifyProviderError({ response: { status: 429 } })).toBe('rate-limited');
    expect(classifyProviderError(new Error('HTTP 429 returned'))).toBe('rate-limited');
    expect(classifyProviderError(new Error('rate limit exceeded'))).toBe('rate-limited');
    expect(classifyProviderError(new Error('ECONNRESET'))).toBe('error');
    expect(classifyProviderError(null)).toBe('error');
  });
});
