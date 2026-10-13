import pino from 'pino';
import {
  localStorePath,
  migrateLegacyStores,
  readJsonStore,
  writeJsonStore,
} from '@/portfolio/local-store';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
});

interface Watchlist {
  tickers: string[];
  createdAt: string;
}

/** Legacy name kept for the one-time migration; the store itself lives under data/. */
const LEGACY_WATCHLIST_FILE = '.watchlist.json';
export const WATCHLIST_FILE = localStorePath('watchlist.json');

function mergeWatchlists(values: Watchlist[]): Watchlist {
  const tickers: string[] = [];
  for (const value of values) {
    for (const entry of Array.isArray(value.tickers) ? value.tickers : []) {
      const ticker = String(entry).toUpperCase();
      if (!tickers.includes(ticker)) tickers.push(ticker);
    }
  }
  const createdAt = values
    .map((value) => value.createdAt)
    .filter((value): value is string => typeof value === 'string')
    .sort()[0];
  return { tickers, createdAt: createdAt ?? new Date().toISOString() };
}

async function loadWatchlist(): Promise<Watchlist> {
  const saved = await readJsonStore<Watchlist>(WATCHLIST_FILE);
  if (saved) return saved;
  const migration = await migrateLegacyStores<Watchlist>(
    WATCHLIST_FILE,
    LEGACY_WATCHLIST_FILE,
    mergeWatchlists
  );
  if (migration.value) {
    logger.info(
      { sources: migration.sources, file: WATCHLIST_FILE, count: migration.value.tickers.length },
      'Migrated legacy watchlist files into the shared store'
    );
    return migration.value;
  }
  logger.info('No existing watchlist found, creating new one');
  return { tickers: [], createdAt: new Date().toISOString() };
}

async function saveWatchlist(watchlist: Watchlist): Promise<void> {
  try {
    await writeJsonStore(WATCHLIST_FILE, watchlist);
    logger.info(`Watchlist saved: ${watchlist.tickers.length} tickers`);
  } catch (error) {
    logger.error({ error }, 'Failed to save watchlist');
    throw error;
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
