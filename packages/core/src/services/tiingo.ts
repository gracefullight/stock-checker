import axios from 'axios';
import { DateTime } from 'luxon';
import pino from 'pino';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
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
  return rows
    .filter((r) => r.close != null && r.date)
    .map((r) => ({
      date: new Date(r.date),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      adjClose: r.adjClose ?? r.close,
      volume: r.volume ?? 0,
    }));
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

  const startDate = DateTime.now().minus({ days: daysAgo }).toISODate();
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
