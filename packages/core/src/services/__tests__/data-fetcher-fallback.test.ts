import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/yahoo-finance', () => ({
  default: { historical: vi.fn(), quote: vi.fn() },
}));
vi.mock('@/services/tiingo', () => ({
  isTiingoConfigured: vi.fn(),
  fetchTiingoDaily: vi.fn(),
}));

import { getHistoricalPrices } from '@/services/data-fetcher';
import { fetchTiingoDaily, isTiingoConfigured } from '@/services/tiingo';
import yahooFinance from '@/services/yahoo-finance';

const mockedHistorical = vi.mocked(yahooFinance.historical);
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
});
