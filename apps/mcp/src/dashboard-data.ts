import type { StockAnalystReport } from '@stock-checker/core/src/reports/stock-analyst.ts';

export interface StockDashboardCandle {
  /** Completed exchange-session date, YYYY-MM-DD. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockDashboardChart {
  ticker: string;
  candles: StockDashboardCandle[];
  status: 'available' | 'unavailable';
  source: string;
  reason: string | null;
}

export interface StockDashboardData {
  report: StockAnalystReport;
  chart: StockDashboardChart;
  markdown: string;
}

const CHART_LOOKBACK_DAYS = 365;
const MAX_CANDLES = 300;
const DAY_MS = 86_400_000;
const CHART_SOURCE = 'Market data service (Yahoo Finance; optional Tiingo fallback)';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function calendarDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

async function loadChartRows(ticker: string): Promise<{ rows: unknown; failed: boolean }> {
  try {
    const prices = await import('@stock-checker/core/src/services/data-fetcher.ts');
    return { rows: await prices.getHistoricalPrices(ticker, CHART_LOOKBACK_DAYS), failed: false };
  } catch {
    return { rows: [], failed: true };
  }
}

function completedCandles(rows: unknown, report: StockAnalystReport): StockDashboardCandle[] {
  if (!Array.isArray(rows)) return [];
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const oldestDate = new Date(now - CHART_LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
  const reportDate = calendarDate(report.dataAsOf);
  // The report identifies the latest completed exchange session. If unavailable,
  // conservatively omit today's UTC date because fallback rows lack session metadata.
  const cutoffDate =
    reportDate && reportDate <= today
      ? reportDate
      : new Date(new Date(`${today}T00:00:00.000Z`).getTime() - DAY_MS).toISOString().slice(0, 10);
  const candles = new Map<string, StockDashboardCandle>();
  for (const value of rows) {
    const row = record(value);
    if (!row || !(row.date instanceof Date) || !Number.isFinite(row.date.getTime())) continue;
    if (row.date.getTime() > now) continue;
    const date = calendarDate(row.date.toISOString().slice(0, 10));
    if (!date || date < oldestDate || date > cutoffDate) continue;
    const { open, high, low, close, volume } = row;
    if (
      !finiteNumber(open) ||
      !finiteNumber(high) ||
      !finiteNumber(low) ||
      !finiteNumber(close) ||
      !finiteNumber(volume) ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      volume < 0 ||
      high < Math.max(open, close) ||
      low > Math.min(open, close)
    ) {
      continue;
    }
    // Adapters already return coherent adjusted OHLC. Do not adjust only the close.
    candles.set(date, { date, open, high, low, close, volume });
  }
  return [...candles.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-MAX_CANDLES);
}

export async function generateStockDashboard(
  ticker: string,
  options: { lookbackDays?: number } = {}
): Promise<StockDashboardData> {
  const symbol = ticker.trim().toUpperCase();
  if (
    symbol.length < 1 ||
    symbol.length > 32 ||
    !/^\^?[A-Z0-9]+(?:[.-][A-Z0-9]+)*(?:=[A-Z0-9]+)?$/.test(symbol)
  ) {
    throw new TypeError('ticker must be a single valid market symbol');
  }
  const lookbackDays = options.lookbackDays ?? 2920;
  if (!Number.isInteger(lookbackDays) || lookbackDays < 730 || lookbackDays > 3650) {
    throw new TypeError('lookbackDays must be an integer from 730 to 3650');
  }
  // Load core at call time, after the stdio entry has configured stderr logging.
  const [{ report, markdown }, chartRows] = await Promise.all([
    import('@stock-checker/core/src/reports/stock-analyst.ts').then((core) =>
      core.generateStockAnalystReport(symbol, { lookbackDays })
    ),
    loadChartRows(symbol),
  ]);
  const candles = completedCandles(chartRows.rows, report);
  const available = candles.length > 0;
  return {
    report,
    chart: {
      ticker: symbol,
      candles,
      status: available ? 'available' : 'unavailable',
      source: CHART_SOURCE,
      reason: available
        ? null
        : chartRows.failed
          ? 'The market data service could not provide completed daily candles.'
          : 'Completed daily candles are unavailable.',
    },
    markdown,
  };
}
