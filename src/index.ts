import yahooFinance from 'yahoo-finance2';
import { rsi, stochastic, bollingerbands } from 'technicalindicators';
import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import pino from 'pino';

// =============================================================================
// Logger configuration
// =============================================================================
const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' }
});

// =============================================================================
// Settings
// =============================================================================
const TICKERS = ['TSLA', 'PLTR', 'IONQ', 'GEV', 'RXRX', 'DNA'];
const CSV_DIR = 'public';

interface TickerResult {
  ticker: string;
  date: string;
  close: number;
  volume: number;
  rsi: number;
  stochasticK: number;
  bbLower: number;
  bbUpper: number;
  fearGreed: number | null;
  opinion: string;
}

// =============================================================================
// Data fetch helpers
// =============================================================================
async function getHistoricalPrices(symbol: string, daysAgo = 365) {
  const end = DateTime.now();
  const start = end.minus({ days: daysAgo });
  return yahooFinance.historical(symbol, {
    period1: start.toJSDate(),
    period2: end.toJSDate(),
    interval: '1d',
    events: 'history',
    includeAdjustedClose: true
  });
}

async function getFearGreedIndex(): Promise<number | null> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1&format=json');
    const json = await res.json();
    const value = parseInt(json?.data?.[0]?.value, 10);
    return Number.isNaN(value) ? null : value;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch fear/greed index');
    return null;
  }
}

function getOpinion(params: {
  rsi: number;
  stoch: number;
  close: number;
  bbLower: number;
  fearGreed: number | null;
}): string {
  const { rsi, stoch, close, bbLower, fearGreed } = params;
  if (rsi < 30 && stoch < 20 && close <= bbLower && (fearGreed ?? 0) < 40) {
    return 'BUY';
  }
  return 'HOLD';
}

// =============================================================================
// Core processing
// =============================================================================
async function processTicker(ticker: string, fearGreed: number | null): Promise<TickerResult | null> {
  logger.info({ ticker }, 'Processing ticker');
  const dailyPrices = await getHistoricalPrices(ticker, 365);
  if (dailyPrices.length === 0) {
    logger.warn({ ticker }, 'No price data');
    return null;
  }

  const latest = dailyPrices[dailyPrices.length - 1];
  const dateStr = latest.date.toISOString().split('T')[0];
  const closes = dailyPrices.map((d) => d.close);
  const highs = dailyPrices.map((d) => d.high);
  const lows = dailyPrices.map((d) => d.low);

  const rsiValues = rsi({ values: closes, period: 14 });
  const latestRsi = rsiValues[rsiValues.length - 1];

  const stochValues = stochastic({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
  const latestStoch = stochValues[stochValues.length - 1];

  const bbValues = bollingerbands({ period: 20, values: closes, stdDev: 2 });
  const latestBb = bbValues[bbValues.length - 1];

  const opinion = getOpinion({
    rsi: latestRsi,
    stoch: latestStoch.k,
    close: latest.close,
    bbLower: latestBb.lower,
    fearGreed
  });

  return {
    ticker,
    date: dateStr,
    close: latest.close,
    volume: latest.volume,
    rsi: latestRsi,
    stochasticK: latestStoch.k,
    bbLower: latestBb.lower,
    bbUpper: latestBb.upper,
    fearGreed,
    opinion
  };
}

async function fetchAndWrite(tickers: string[]) {
  const fearGreed = await getFearGreedIndex();
  const results = (
    await Promise.all(tickers.map((t) => processTicker(t, fearGreed)))
  ).filter((r): r is TickerResult => r !== null);
  await writeToCsv(results);
}

// =============================================================================
// CSV writer
// =============================================================================
async function writeToCsv(data: TickerResult[]) {
  if (data.length === 0) {
    logger.info('No data to write to CSV');
    return;
  }

  if (!fs.existsSync(CSV_DIR)) {
    fs.mkdirSync(CSV_DIR, { recursive: true });
  }
  const filePath = path.join(CSV_DIR, `stock_data_${DateTime.now().toFormat('yyyyLLdd')}.csv`);
  const fileExists = fs.existsSync(filePath);

  const header = [
    'Date',
    'Ticker',
    'Close',
    'Volume',
    'RSI',
    'StochK',
    'BBLower',
    'BBUpper',
    'FearGreed',
    'Opinion'
  ].join(',');

  let csv = '';
  if (!fileExists) {
    csv += header + '\n';
  }

  data.forEach((item) => {
    const row = [
      item.date,
      item.ticker,
      item.close.toFixed(2),
      item.volume,
      item.rsi.toFixed(2),
      item.stochasticK.toFixed(2),
      item.bbLower.toFixed(2),
      item.bbUpper.toFixed(2),
      item.fearGreed ?? '',
      item.opinion
    ].join(',');
    csv += row + '\n';
  });

  fs.appendFileSync(filePath, csv, { encoding: 'utf-8' });
  logger.info(`[CSV written] ${filePath}`);
}

// =============================================================================
// Run
// =============================================================================
if (require.main === module) {
  fetchAndWrite(TICKERS).catch((err) => logger.error({ err }, 'Unexpected error'));
}

