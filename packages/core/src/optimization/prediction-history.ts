import { DateTime } from 'luxon';
import type { PredictionInput } from '@/optimization/evaluator';
import { getHistoricalPrices } from '@/services/data-fetcher';

interface DailyPrice {
  date: Date;
  close: number;
  adjClose?: number;
}

interface HistoryOptions {
  now?: Date;
  fetchPrices?: (ticker: string, daysAgo: number) => Promise<DailyPrice[]>;
}

export interface PredictionHistoryDiagnostic {
  ticker: string;
  reason: 'fetch-failed' | 'empty-history';
}

/** Load a complete daily provider series once per directional forecast ticker. */
export async function loadPredictionPriceHistory(
  predictions: PredictionInput[],
  options: HistoryOptions = {}
): Promise<{
  priceHistory: Map<string, Map<string, number>>;
  diagnostics: PredictionHistoryDiagnostic[];
}> {
  const now = DateTime.fromJSDate(options.now ?? new Date(), { zone: 'utc' });
  const today = now.startOf('day');
  const todayDate = today.toISODate();
  const earliestByTicker = new Map<string, string>();

  for (const prediction of predictions) {
    if (prediction.Opinion !== 'BUY' && prediction.Opinion !== 'SELL') continue;
    if (typeof prediction.Ticker !== 'string' || !prediction.Ticker.trim()) continue;
    if (typeof prediction.Date !== 'string') continue;
    const date = DateTime.fromISO(prediction.Date, { zone: 'utc' });
    if (!date.isValid || date.toISODate() !== prediction.Date || date > today) continue;
    const earliest = earliestByTicker.get(prediction.Ticker);
    if (!earliest || prediction.Date < earliest) {
      earliestByTicker.set(prediction.Ticker, prediction.Date);
    }
  }

  const requests = [...earliestByTicker];
  const priceHistory = new Map<string, Map<string, number>>();
  const diagnostics: PredictionHistoryDiagnostic[] = [];
  const fetchPrices = options.fetchPrices ?? getHistoricalPrices;
  let nextRequest = 0;

  async function worker() {
    while (nextRequest < requests.length) {
      const [ticker, earliestDate] = requests[nextRequest++];
      const start = DateTime.fromISO(earliestDate, { zone: 'utc' });
      // One extra calendar day includes the earliest session despite the provider's time of day.
      const daysAgo = Math.round(today.diff(start, 'days').days) + 1;
      try {
        const rows = await fetchPrices(ticker, daysAgo);
        const history = new Map<string, number>();
        for (const row of rows) {
          const date = DateTime.fromJSDate(row.date, { zone: 'utc' }).toISODate();
          if (!date || date < earliestDate || !todayDate || date > todayDate) continue;
          // Provider adapters normalize corporate actions. Do not mix forecast CSV prices.
          // Keep observed dates with unusable prices so the evaluator never shifts the horizon.
          history.set(date, row.adjClose ?? row.close);
        }
        if (![...history.values()].some((close) => Number.isFinite(close) && close > 0)) {
          diagnostics.push({ ticker, reason: 'empty-history' });
          continue;
        }
        priceHistory.set(ticker, history);
      } catch {
        diagnostics.push({ ticker, reason: 'fetch-failed' });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(2, requests.length) }, () => worker()));
  return { priceHistory, diagnostics };
}
