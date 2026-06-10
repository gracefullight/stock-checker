import { promises as fs } from 'node:fs';
import pino from 'pino';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
});

interface Watchlist {
  tickers: string[];
  createdAt: string;
}

const WATCHLIST_FILE = '.watchlist.json';

async function loadWatchlist(): Promise<Watchlist> {
  try {
    const data = await fs.readFile(WATCHLIST_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (_error) {
    logger.info('No existing watchlist found, creating new one');
    return { tickers: [], createdAt: new Date().toISOString() };
  }
}

async function saveWatchlist(watchlist: Watchlist): Promise<void> {
  try {
    await fs.writeFile(WATCHLIST_FILE, JSON.stringify(watchlist, null, 2), 'utf-8');
    logger.info(`Watchlist saved: ${watchlist.tickers.length} tickers`);
  } catch (error) {
    logger.error({ error }, 'Failed to save watchlist');
  }
}

export async function addTicker(ticker: string): Promise<void> {
  const watchlist = await loadWatchlist();

  if (watchlist.tickers.includes(ticker)) {
    logger.info({ ticker }, 'Ticker already in watchlist');
    return;
  }

  watchlist.tickers.push(ticker);
  await saveWatchlist(watchlist);
  logger.info({ ticker, count: watchlist.tickers.length }, 'Ticker added to watchlist');
}

export async function removeTicker(ticker: string): Promise<void> {
  const watchlist = await loadWatchlist();

  const index = watchlist.tickers.indexOf(ticker);
  if (index === -1) {
    logger.warn({ ticker }, 'Ticker not found in watchlist');
    return;
  }

  watchlist.tickers.splice(index, 1);
  await saveWatchlist(watchlist);
  logger.info({ ticker, count: watchlist.tickers.length }, 'Ticker removed from watchlist');
}

export async function getWatchlist(): Promise<Watchlist> {
  return await loadWatchlist();
}
