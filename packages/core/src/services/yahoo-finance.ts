import { DateTime } from 'luxon';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
});

export interface YahooDailyRow {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
  /** Nominal session close times share volume, before dividend adjustment. */
  dollarVolume?: number;
}

/**
 * Daily OHLCV via chart(). historical() is a compatibility shim over chart()
 * whose row validation rejects the entire response whenever Yahoo appends an
 * in-progress bar with null close — which it does on every live trading day —
 * so we call chart() directly and drop incomplete bars ourselves. OHLC uses
 * the adjusted-close scale consistently (splits and dividend distributions).
 */
export async function fetchYahooDaily(
  symbol: string,
  period1: Date,
  period2: Date
): Promise<YahooDailyRow[]> {
  const { quotes, meta } = await yahooFinance.chart(symbol, {
    period1,
    period2,
    interval: '1d',
  });

  const timezone = meta?.exchangeTimezoneName ?? 'UTC';
  const regularSession = meta?.currentTradingPeriod?.regular;
  const openSessionDate = regularSession
    ? DateTime.fromJSDate(regularSession.start, { zone: timezone }).toISODate()
    : null;
  const sessionIsOpen = regularSession && Date.now() < regularSession.end.getTime();
  const rows = new Map<string, YahooDailyRow>();
  for (const q of quotes) {
    if (
      q.close == null ||
      q.open == null ||
      q.high == null ||
      q.low == null ||
      ![q.open, q.high, q.low, q.close].every((v) => Number.isFinite(v) && v > 0) ||
      q.high < Math.max(q.open, q.close) ||
      q.low > Math.min(q.open, q.close) ||
      !(q.date instanceof Date) ||
      !Number.isFinite(q.date.getTime()) ||
      q.date.getTime() > Math.min(Date.now(), period2.getTime())
    )
      continue;

    const sessionDate = DateTime.fromJSDate(q.date, { zone: timezone }).toISODate();
    if (!sessionDate || (sessionIsOpen && sessionDate === openSessionDate)) continue;
    const close = q.adjclose ?? q.close;
    const volume = q.volume ?? 0;
    if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(volume) || volume < 0) continue;
    const dollarVolume = q.close * volume;
    if (!Number.isFinite(dollarVolume)) continue;
    const factor = close / q.close;
    const open = q.open * factor;
    const high = q.high * factor;
    const low = q.low * factor;
    if (![open, high, low].every((v) => Number.isFinite(v) && v > 0)) continue;

    rows.set(sessionDate, {
      date: new Date(`${sessionDate}T00:00:00.000Z`),
      open,
      high,
      low,
      close,
      adjClose: close,
      // Yahoo's share volume is already split-adjusted; dividend ratios must
      // not be applied to the number of shares traded.
      volume,
      dollarVolume,
    });
  }
  return [...rows.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export default yahooFinance;
