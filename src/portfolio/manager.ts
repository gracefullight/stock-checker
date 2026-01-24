import { promises as fs } from 'node:fs';
import pino from 'pino';
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

const PORTFOLIO_FILE = '.portfolio.json';

async function loadPortfolio(): Promise<Portfolio> {
  try {
    const data = await fs.readFile(PORTFOLIO_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (_error) {
    logger.info('No existing portfolio found, creating new one');
    return { assets: [], createdAt: new Date().toISOString() };
  }
}

async function savePortfolio(portfolio: Portfolio): Promise<void> {
  try {
    await fs.writeFile(PORTFOLIO_FILE, JSON.stringify(portfolio, null, 2), 'utf-8');
    logger.info(`Portfolio saved: ${portfolio.assets.length} assets`);
  } catch (error) {
    logger.error({ error }, 'Failed to save portfolio');
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

  for (const result of results) {
    if (!tickers.includes(result.ticker)) continue;

    report.push(`## ${result.ticker}`);
    report.push(`- Opinion: ${result.opinion}`);
    report.push(`- Close: ${result.close.toFixed(2)}`);
    report.push(`- RSI: ${result.rsi.toFixed(2)}`);
    report.push(`- Score: ${result.score.toFixed(2)}`);
    report.push('');
  }

  return report.join('\n');
}
