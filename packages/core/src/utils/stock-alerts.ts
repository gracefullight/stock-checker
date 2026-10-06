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
  const asOf = `종가 ${dates.length === 1 ? dates[0] : `${dates[0]}~${dates[dates.length - 1]}`}`;
  const details = actionable.slice(0, 5).map((item) => {
    const price = `${item.ticker} ${item.opinion} · 종가 참고 ${item.close.toFixed(2)}`;
    return item.opinion === 'BUY'
      ? `${price} · ATR 손절 참고 ${item.stopLoss.toFixed(2)} · 목표 참고 ${item.takeProfit.toFixed(2)}`
      : `${price} · 보유 포지션 청산 경고`;
  });
  return {
    title: '주식 신호',
    asOf,
    summary: details.join('\n'),
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
      title: '주식 신호',
      asOf: `종가 ${dates.length === 1 ? dates[0] : `${dates[0]}~${dates[dates.length - 1]}`}`,
      coverageSummary: `BUY ${buyCount} · SELL ${actionable.length - buyCount} · 알림 ${Math.min(3, actionable.length)}/${actionable.length}개`,
      lookbackDays: 730,
      candidates,
    },
    dependencies
  );
}
