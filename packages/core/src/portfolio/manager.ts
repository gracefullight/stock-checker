import pino from 'pino';
import {
  localStorePath,
  migrateLegacyStores,
  readJsonStore,
  writeJsonStore,
} from '@/portfolio/local-store';
import type { TickerResult } from '@/types';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
});

interface Portfolio {
  assets: string[];
  createdAt: string;
}

/** Legacy name kept for the one-time migration; the store itself lives under data/. */
const LEGACY_PORTFOLIO_FILE = '.portfolio.json';
export const PORTFOLIO_FILE = localStorePath('portfolio.json');

function mergePortfolios(values: Portfolio[]): Portfolio {
  const assets: string[] = [];
  for (const value of values) {
    for (const asset of Array.isArray(value.assets) ? value.assets : []) {
      const ticker = String(asset).toUpperCase();
      if (!assets.includes(ticker)) assets.push(ticker);
    }
  }
  const createdAt = values
    .map((value) => value.createdAt)
    .filter((value): value is string => typeof value === 'string')
    .sort()[0];
  return { assets, createdAt: createdAt ?? new Date().toISOString() };
}

async function loadPortfolio(): Promise<Portfolio> {
  const saved = await readJsonStore<Portfolio>(PORTFOLIO_FILE);
  if (saved) return saved;
  const migration = await migrateLegacyStores<Portfolio>(
    PORTFOLIO_FILE,
    LEGACY_PORTFOLIO_FILE,
    mergePortfolios
  );
  if (migration.value) {
    logger.info(
      { sources: migration.sources, file: PORTFOLIO_FILE, count: migration.value.assets.length },
      'Migrated legacy portfolio files into the shared store'
    );
    return migration.value;
  }
  logger.info('No existing portfolio found, creating new one');
  return { assets: [], createdAt: new Date().toISOString() };
}

async function savePortfolio(portfolio: Portfolio): Promise<void> {
  try {
    await writeJsonStore(PORTFOLIO_FILE, portfolio);
    logger.info(`Portfolio saved: ${portfolio.assets.length} assets`);
  } catch (error) {
    logger.error({ error }, 'Failed to save portfolio');
    throw error;
  }
}

export async function addAsset(ticker: string): Promise<void> {
  const portfolio = await loadPortfolio();

  if (portfolio.assets.includes(ticker)) {
    logger.info({ ticker }, 'Asset already in portfolio');
    return;
  }

  portfolio.assets.push(ticker);
  await savePortfolio(portfolio);
  logger.info({ ticker, count: portfolio.assets.length }, 'Asset added to portfolio');
}

export async function removeAsset(ticker: string): Promise<void> {
  const portfolio = await loadPortfolio();

  const index = portfolio.assets.indexOf(ticker);
  if (index === -1) {
    logger.warn({ ticker }, 'Asset not found in portfolio');
    return;
  }

  portfolio.assets.splice(index, 1);
  await savePortfolio(portfolio);
  logger.info({ ticker, count: portfolio.assets.length }, 'Asset removed from portfolio');
}

export async function getPortfolio(): Promise<Portfolio> {
  return await loadPortfolio();
}

export async function generatePerformanceReport(
  tickers: string[],
  results: TickerResult[]
): Promise<string> {
  const report: string[] = [];
  report.push('# Portfolio Performance Report');
  report.push(`Generated: ${new Date().toISOString()}`);
  report.push('');

  const missing = tickers.filter((ticker) => !results.some((result) => result.ticker === ticker));
  if (missing.length > 0) {
    report.push(`Unavailable (no usable analysis): ${missing.join(', ')}`);
    report.push('');
  }

  for (const result of results) {
    if (!tickers.includes(result.ticker)) continue;

    report.push(`## ${result.ticker}`);
    report.push(`- Opinion: ${result.opinion}`);
    report.push(`- Session: ${result.date}`);
    report.push(`- Close: ${result.close.toFixed(2)}`);
    report.push(`- RSI: ${result.rsi.toFixed(2)}`);
    report.push(`- Score: ${result.score.toFixed(2)}`);
    report.push('');
  }

  return report.join('\n');
}
