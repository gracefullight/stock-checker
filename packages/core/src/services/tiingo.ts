import axios from 'axios';
import { DateTime } from 'luxon';
import pino from 'pino';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: {
    target: 'pino-pretty',
    options: process.env.MCP_LOG_STDERR === '1' ? { destination: 2 } : undefined,
  },
});

const axiosInstance = axios.create({
  baseURL: 'https://api.tiingo.com',
  timeout: 30000,
});

export interface TiingoCandle {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
  /** Nominal session close times raw share volume, before corporate-action adjustment. */
  dollarVolume?: number;
}

interface RawTiingoRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjOpen?: number;
  adjHigh?: number;
  adjLow?: number;
  adjClose?: number;
  volume: number;
  adjVolume?: number;
}

/** Fallback OHLCV source is active only when a Tiingo API key is provisioned. */
export function isTiingoConfigured(): boolean {
  return Boolean(process.env.TIINGO_API_KEY);
}

export function mapTiingoRows(rows: RawTiingoRow[]): TiingoCandle[] {
  const candles = new Map<string, TiingoCandle>();
  for (const r of rows) {
    const sessionDate = DateTime.fromISO(r.date, { zone: 'utc' }).toISODate();
    if (!sessionDate || !Number.isFinite(r.close) || r.close <= 0) continue;
    const close = r.adjClose ?? r.close;
    const factor = close / r.close;
    // Tiingo adjusted prices include both splits and dividends. Preserve one
    // scale even when an optional adjusted range field is absent.
    const open = r.adjClose == null ? r.open : (r.adjOpen ?? r.open * factor);
    const high = r.adjClose == null ? r.high : (r.adjHigh ?? r.high * factor);
    const low = r.adjClose == null ? r.low : (r.adjLow ?? r.low * factor);
    const volume = (r.adjClose == null ? r.volume : (r.adjVolume ?? r.volume)) ?? 0;
    const rawVolume = r.volume ?? 0;
    const dollarVolume = r.close * rawVolume;
    if (
      ![open, high, low, close].every((v) => Number.isFinite(v) && v > 0) ||
      high < Math.max(open, close) ||
      low > Math.min(open, close) ||
      !Number.isFinite(volume) ||
      volume < 0 ||
      !Number.isFinite(rawVolume) ||
      rawVolume < 0 ||
      !Number.isFinite(dollarVolume)
    )
      continue;
    candles.set(sessionDate, {
      date: new Date(`${sessionDate}T00:00:00.000Z`),
      open,
      high,
      low,
      close,
      adjClose: close,
      volume,
      dollarVolume,
    });
  }
  return [...candles.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Daily OHLCV from Tiingo (free tier: 1,000 req/day, 500 unique symbols/month,
 * 30+ years of history) — used as a fallback when Yahoo is rate-limited or down.
 * Throws on failure; the caller decides how to degrade.
 */
export async function fetchTiingoDaily(symbol: string, daysAgo: number): Promise<TiingoCandle[]> {
  const token = process.env.TIINGO_API_KEY;
  if (!token) {
    throw new Error('TIINGO_API_KEY is not set');
  }

  const startDate = DateTime.now().setZone('America/New_York').minus({ days: daysAgo }).toISODate();
  const res = await axiosInstance.get<RawTiingoRow[]>(
    `/tiingo/daily/${encodeURIComponent(symbol)}/prices`,
    { params: { startDate, token } }
  );

  if (!Array.isArray(res.data)) {
    throw new Error('Unexpected Tiingo response shape');
  }

  const candles = mapTiingoRows(res.data);
  logger.info({ symbol, bars: candles.length }, 'Fetched daily candles from Tiingo (fallback)');
  return candles;
}
