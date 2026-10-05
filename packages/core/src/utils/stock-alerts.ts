import { gateReasons } from '@/reports/signal-reasons';
import type { TickerAnalysisContext } from '@/services/ticker-analysis';
import type { TickerResult } from '@/types';
import {
  buildStockReportWhatsAppNotification,
  type StockReportAlertCandidate,
} from '@/utils/stock-report-alerts';
import type { WhatsAppNotification } from '@/utils/whatsapp';

type SignalReference = Pick<
  TickerResult,
  'ticker' | 'date' | 'opinion' | 'close' | 'stopLoss' | 'takeProfit'
>;

/** One summary per prediction run; HOLD results never trigger a signal alert. */
export function buildStockSignalNotification(
  results: SignalReference[]
): WhatsAppNotification | null {
  const actionable = results.filter((item) => item.opinion === 'BUY' || item.opinion === 'SELL');
  if (actionable.length === 0) return null;

  const dates = [...new Set(actionable.map((item) => item.date))].sort();
  const asOf = dates.length === 1 ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`;
  const buyCount = actionable.filter((item) => item.opinion === 'BUY').length;
  const details = actionable.slice(0, 5).map((item) => {
    const price = `${item.ticker} ${item.opinion} close ${item.close.toFixed(2)}`;
    return item.opinion === 'BUY'
      ? `${price}, ATR stop ${item.stopLoss.toFixed(2)}, target ${item.takeProfit.toFixed(2)}`
      : `${price} (exit signal)`;
  });
  const coverage = actionable.length > 5 ? `; showing 5 of ${actionable.length}` : '';

  return {
    title: 'Stock signals',
    asOf,
    summary: `BUY ${buyCount}; SELL ${actionable.length - buyCount}; ${details.join('; ')}${coverage}. Prices are completed-close references.`,
  };
}

/** Enrich the saved signal snapshot using the exact configuration used by this run. */
export async function buildStockSignalReportNotification(
  results: TickerResult[],
  contexts: ReadonlyMap<string, TickerAnalysisContext>,
  dependencies?: Parameters<typeof buildStockReportWhatsAppNotification>[1]
): Promise<WhatsAppNotification | null> {
  const actionable = results.filter((item) => item.opinion === 'BUY' || item.opinion === 'SELL');
  if (!actionable.length) return null;
  const dates = [...new Set(actionable.map((item) => item.date))].sort();
  const buyCount = actionable.filter((item) => item.opinion === 'BUY').length;
  const candidates: StockReportAlertCandidate[] = actionable.map((item) => {
    const context = contexts.get(item.ticker);
    return {
      ticker: item.ticker,
      decision: item.opinion === 'BUY' ? 'BUY' : 'SELL',
      dataAsOf: item.date,
      reference: {
        price: item.close,
        stopLoss: item.stopLoss,
        takeProfit: item.takeProfit,
        atr: item.atr,
      },
      ...(context ? { context, gateReasons: gateReasons(context) } : {}),
    };
  });
  return buildStockReportWhatsAppNotification(
    {
      title: 'Stock signals',
      asOf: dates.length === 1 ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`,
      coverageSummary: `BUY ${buyCount}; SELL ${actionable.length - buyCount}; alert shows ${Math.min(3, actionable.length)}/${actionable.length} signals.`,
      lookbackDays: 730,
      candidates,
    },
    dependencies
  );
}
