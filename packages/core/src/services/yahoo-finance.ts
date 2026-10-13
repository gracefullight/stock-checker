import { DateTime } from 'luxon';
import pino from 'pino';
import YahooFinance from 'yahoo-finance2';
import { ExtendedCookieJar } from 'yahoo-finance2/lib/cookieJar';

const stderrLogger = pino({ level: 'info' }, pino.destination(2));
export const yahooCookieJar = new ExtendedCookieJar();

const yahooFinance = new YahooFinance({
  cookieJar: yahooCookieJar,
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
  ...(process.env.MCP_LOG_STDERR === '1'
    ? {
        logger: {
          info: (...args: unknown[]) => stderrLogger.info({ args }, 'Yahoo Finance'),
          warn: (...args: unknown[]) => stderrLogger.warn({ args }, 'Yahoo Finance'),
          error: (...args: unknown[]) => stderrLogger.error({ args }, 'Yahoo Finance'),
          debug: (...args: unknown[]) => stderrLogger.debug({ args }, 'Yahoo Finance'),
          dir: (...args: unknown[]) => stderrLogger.debug({ args }, 'Yahoo Finance'),
        },
      }
    : {}),
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
  // Every rejected bar is logged with its reason so a silently missing latest
  // session (decision made on the prior bar) can be diagnosed. Expected drops
  // (the in-progress session, bars after the requested window) log at debug.
  const drop = (q: (typeof quotes)[number], reason: string, expected = false) => {
    const date = q.date instanceof Date && Number.isFinite(q.date.getTime()) ? q.date : null;
    stderrLogger[expected ? 'debug' : 'info'](
      { symbol, date: date?.toISOString() ?? null, reason },
      'Dropped daily bar'
    );
  };
  for (const q of quotes) {
    if (!(q.date instanceof Date) || !Number.isFinite(q.date.getTime())) {
      drop(q, 'invalid-date');
      continue;
    }
    if (q.date.getTime() > Math.min(Date.now(), period2.getTime())) {
      drop(q, 'after-window', true);
      continue;
    }
    if (q.close == null || q.open == null || q.high == null || q.low == null) {
      // Yahoo appends the live in-progress bar with null close on trading days.
      drop(q, 'incomplete-ohlc', sessionIsOpen === true);
      continue;
    }
    if (![q.open, q.high, q.low, q.close].every((v) => Number.isFinite(v) && v > 0)) {
      drop(q, 'nonpositive-ohlc');
      continue;
    }
    if (q.high < Math.max(q.open, q.close) || q.low > Math.min(q.open, q.close)) {
      drop(q, 'inconsistent-ohlc-range');
      continue;
    }

    const sessionDate = DateTime.fromJSDate(q.date, { zone: timezone }).toISODate();
    if (!sessionDate) {
      drop(q, 'invalid-session-date');
      continue;
    }
    if (sessionIsOpen && sessionDate === openSessionDate) {
      drop(q, 'session-in-progress', true);
      continue;
    }
    const close = q.adjclose ?? q.close;
    const volume = q.volume ?? 0;
    if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(volume) || volume < 0) {
      drop(q, 'invalid-adjclose-or-volume');
      continue;
    }
    const dollarVolume = q.close * volume;
    if (!Number.isFinite(dollarVolume)) {
      drop(q, 'nonfinite-dollar-volume');
      continue;
    }
    const factor = close / q.close;
    const open = q.open * factor;
    const high = q.high * factor;
    const low = q.low * factor;
    if (![open, high, low].every((v) => Number.isFinite(v) && v > 0)) {
      drop(q, 'nonfinite-adjusted-ohlc');
      continue;
    }

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
