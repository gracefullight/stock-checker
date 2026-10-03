import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from 'bun:test';
import { generateStockDashboard } from '@mcp/dashboard-data.ts';
import { fixtureReport } from '@mcp/test-fixtures/report.ts';

const reportMock = mock(async (ticker: string, _options: { lookbackDays: number }) => ({
  report: fixtureReport(ticker),
  markdown: `# ${ticker} fixture report`,
}));
const pricesMock = mock(async (_ticker: string, _days: number): Promise<unknown> => []);

mock.module('@stock-checker/core/src/reports/stock-analyst.ts', () => ({
  generateStockAnalystReport: reportMock,
}));
mock.module('@stock-checker/core/src/services/data-fetcher.ts', () => ({
  getHistoricalPrices: pricesMock,
}));

const NOW = new Date('2026-10-03T12:00:00.000Z');
const DAY_MS = 86_400_000;

function candle(date = '2026-10-02', overrides: Record<string, unknown> = {}) {
  return {
    date: new Date(`${date}T00:00:00.000Z`),
    open: 40,
    high: 44,
    low: 39,
    close: 42,
    adjClose: 42,
    volume: 1_000,
    ...overrides,
  };
}

describe('inline dashboard data', () => {
  beforeEach(() => {
    setSystemTime(NOW);
    reportMock.mockReset();
    pricesMock.mockReset();
    reportMock.mockImplementation(async (ticker, options) => ({
      report: { ...fixtureReport(ticker), lookbackDays: options.lookbackDays },
      markdown: `# ${ticker} fixture report`,
    }));
    pricesMock.mockResolvedValue([candle()]);
  });

  afterEach(() => {
    setSystemTime();
  });

  test('normalizes one ticker and returns the complete report with a completed adjusted-price chart', async () => {
    pricesMock.mockResolvedValue([
      candle('2026-10-01', { open: 20, high: 22, low: 19, close: 21, adjClose: 21 }),
      candle(),
    ]);

    const result = await generateStockDashboard(' oii ');

    expect(result.report.ticker).toBe('OII');
    expect(result.markdown).toBe('# OII fixture report');
    expect(result.chart).toEqual({
      ticker: 'OII',
      candles: [
        { date: '2026-10-01', open: 20, high: 22, low: 19, close: 21, volume: 1_000 },
        { date: '2026-10-02', open: 40, high: 44, low: 39, close: 42, volume: 1_000 },
      ],
      status: 'available',
      source: 'Market data service (Yahoo Finance; optional Tiingo fallback)',
      reason: null,
    });
    expect(reportMock).toHaveBeenCalledWith('OII', { lookbackDays: 2920 });
    expect(pricesMock).toHaveBeenCalledWith('OII', 365);
  });

  test('bounds chart requests independently of the historical report lookback and takes the newest 300 dates', async () => {
    const rows = Array.from({ length: 400 }, (_, index) => {
      const date = new Date(NOW.getTime() - (index + 1) * DAY_MS).toISOString().slice(0, 10);
      return candle(date);
    });
    pricesMock.mockResolvedValue(rows);

    const result = await generateStockDashboard('OII', { lookbackDays: 3650 });

    expect(result.chart.candles).toHaveLength(300);
    expect(result.chart.candles[0]?.date).toBe(
      new Date(NOW.getTime() - 300 * DAY_MS).toISOString().slice(0, 10)
    );
    expect(result.chart.candles.at(-1)?.date).toBe('2026-10-02');
    expect(reportMock).toHaveBeenCalledWith('OII', { lookbackDays: 3650 });
    expect(pricesMock).toHaveBeenCalledWith('OII', 365);
    expect(result.report.lookbackDays).toBe(3650);
  });

  test('drops invalid or inconsistent OHLC, invalid volumes, old and future dates without filling gaps', async () => {
    pricesMock.mockResolvedValue([
      candle('2026-09-30', { volume: 0 }),
      candle('2026-10-01', { open: 43, high: 44, low: 41, close: 42 }),
      candle('2026-10-02', { open: 45 }),
      candle('2026-10-02', { close: Number.NaN }),
      candle('2026-10-02', { high: Number.POSITIVE_INFINITY }),
      candle('2026-10-02', { low: 41 }),
      candle('2026-10-02', { volume: -1 }),
      candle('2026-10-02', { volume: '1000' }),
      candle('2026-10-02', { close: 0 }),
      candle('2026-10-02', { date: new Date('invalid') }),
      candle('2026-10-02', { date: '2026-10-02' }),
      candle('2024-10-02'),
      candle('2026-10-04'),
      null,
    ]);

    const result = await generateStockDashboard('OII');

    expect(result.chart.candles.map((row) => row.date)).toEqual(['2026-09-30', '2026-10-01']);
    expect(result.chart.candles[0]?.volume).toBe(0);
    expect(result.chart.status).toBe('available');
  });

  test('deduplicates actual session dates and sorts retained provider observations', async () => {
    pricesMock.mockResolvedValue([
      candle('2026-10-02'),
      candle('2026-09-30'),
      candle('2026-10-01'),
      candle('2026-10-02', { close: 43, high: 45 }),
    ]);

    const result = await generateStockDashboard('OII');

    expect(result.chart.candles).toHaveLength(3);
    expect(result.chart.candles.map((row) => row.date)).toEqual([
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
    expect(result.chart.candles.at(-1)?.close).toBe(43);
  });

  test('does not chart provider rows after the report’s latest completed exchange session', async () => {
    reportMock.mockResolvedValue({
      report: { ...fixtureReport('OII'), dataAsOf: '2026-09-30' },
      markdown: '# completed-session report',
    });
    pricesMock.mockResolvedValue([
      candle('2026-09-30'),
      candle('2026-10-01'),
      candle('2026-10-02'),
      candle('2026-10-03'),
    ]);

    const result = await generateStockDashboard('OII');

    expect(result.chart.candles.map((row) => row.date)).toEqual(['2026-09-30']);
  });

  test('preserves an unavailable report and safely omits today’s potential partial fallback candle', async () => {
    reportMock.mockResolvedValue({
      report: fixtureReport('OII', 'unavailable'),
      markdown: '# analysis unavailable',
    });
    pricesMock.mockResolvedValue([candle('2026-10-02'), candle('2026-10-03')]);

    const result = await generateStockDashboard('OII');

    expect(result.report.status).toBe('unavailable');
    expect(result.markdown).toBe('# analysis unavailable');
    expect(result.chart.status).toBe('available');
    expect(result.chart.candles.map((row) => row.date)).toEqual(['2026-10-02']);
  });

  test.each([null, '2026-02-30', 'bad-date', '2026-10-04'])(
    'uses a conservative completion cutoff when report dataAsOf is %s',
    async (dataAsOf) => {
      reportMock.mockResolvedValue({
        report: { ...fixtureReport('OII'), dataAsOf },
        markdown: '# no verified completed session',
      });
      pricesMock.mockResolvedValue([candle('2026-10-02'), candle('2026-10-03')]);

      const result = await generateStockDashboard('OII');

      expect(result.chart.candles.map((row) => row.date)).toEqual(['2026-10-02']);
    }
  );

  test('preserves report and markdown when the separate chart request fails and removes private errors', async () => {
    pricesMock.mockRejectedValue(new Error('https://provider.example?token=fixture-secret'));

    const result = await generateStockDashboard('OII');

    expect(result.report.status).toBe('available');
    expect(result.markdown).toBe('# OII fixture report');
    expect(result.chart).toMatchObject({
      ticker: 'OII',
      candles: [],
      status: 'unavailable',
      reason: 'The market data service could not provide completed daily candles.',
    });
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
    expect(JSON.stringify(result)).not.toContain('provider.example');
  });

  test.each([[], null, { malformed: 'payload' }, [candle('2026-10-02', { close: 0 })]])(
    'returns nullable availability rather than fabricating chart points from %j',
    async (rows) => {
      pricesMock.mockResolvedValue(rows);

      const result = await generateStockDashboard('OII');

      expect(result.chart).toMatchObject({
        candles: [],
        status: 'unavailable',
        reason: 'Completed daily candles are unavailable.',
      });
      expect(result.report.ticker).toBe('OII');
    }
  );

  test('starts report and chart independently so the chart request does not wait for report completion', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    reportMock.mockImplementation(async (ticker) => {
      await blocked;
      return { report: fixtureReport(ticker), markdown: '# parallel fixture' };
    });

    const request = generateStockDashboard('OII');
    for (let tick = 0; tick < 20; tick++) await Promise.resolve();
    expect(reportMock).toHaveBeenCalledTimes(1);
    expect(pricesMock).toHaveBeenCalledTimes(1);
    release?.();
    expect((await request).chart.status).toBe('available');
  });

  test.each(['brk-b', '^gspc', '005930.KS', 'CL=F', 'A'.repeat(32)])(
    'accepts the same valid single-symbol forms as the report for %s',
    async (ticker) => {
      const result = await generateStockDashboard(ticker);

      expect(result.chart.ticker).toBe(ticker.toUpperCase());
      expect(reportMock).toHaveBeenCalledTimes(1);
      expect(pricesMock).toHaveBeenCalledTimes(1);
    }
  );

  test.each(['', ' ', '../OII', 'OII,MSFT', 'OII?secret=value', 'OII\u0000', 'A'.repeat(33)])(
    'rejects invalid ticker %s before loading report or chart data',
    async (ticker) => {
      await expect(generateStockDashboard(ticker)).rejects.toThrow('single valid market symbol');
      expect(reportMock).not.toHaveBeenCalled();
      expect(pricesMock).not.toHaveBeenCalled();
    }
  );

  test.each([729, 3651, 730.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects out-of-range or noninteger lookback %s before provider calls',
    async (lookbackDays) => {
      await expect(generateStockDashboard('OII', { lookbackDays })).rejects.toThrow(
        'integer from 730 to 3650'
      );
      expect(reportMock).not.toHaveBeenCalled();
      expect(pricesMock).not.toHaveBeenCalled();
    }
  );

  test.each([730, 3650])('accepts report lookback boundary %s', async (lookbackDays) => {
    await generateStockDashboard('OII', { lookbackDays });

    expect(reportMock).toHaveBeenCalledWith('OII', { lookbackDays });
    expect(pricesMock).toHaveBeenCalledWith('OII', 365);
  });
});
