import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import pino from 'pino';
import { CSV_DIR } from '../constants';
import type { TickerResult } from '../types';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' }
});

async function formatCsvRow(item: TickerResult): Promise<string> {
  const row = [
    item.date,
    item.ticker,
    item.close.toFixed(2),
    item.volume,
    item.rsi.toFixed(2),
    item.stochasticK.toFixed(2),
    item.bbLower.toFixed(2),
    item.bbUpper.toFixed(2),
    item.donchLower.toFixed(2),
    item.donchUpper.toFixed(2),
    item.williamsR.toFixed(2),
    item.fearGreed ?? '',
    item.patterns.join('|'),
    item.score.toFixed(2),
    item.opinion,
    item.atr.toFixed(2),
    item.stopLoss.toFixed(2),
    item.takeProfit.toFixed(2),
    item.trailingStop.toFixed(2),
    item.trailingStart.toFixed(2)
  ].join(',');
  return row + '\n';
}

export async function writeToCsv(data: TickerResult[]): Promise<void> {
  if (data.length === 0) {
    logger.info('No data to write to CSV');
    return;
  }

  if (!existsSync(CSV_DIR)) {
    await fs.mkdir(CSV_DIR, { recursive: true });
  }
  const filePath = path.join(CSV_DIR, `stock_data_${DateTime.now().toFormat('yyyyLLdd')}.csv`);
  const fileExists = existsSync(filePath);

  const header = [
    'Date',
    'Ticker',
    'Close',
    'Volume',
    'RSI',
    'StochK',
    'BBLower',
    'BBUpper',
    'DonchLower',
    'DonchUpper',
    'WilliamsR',
    'FearGreed',
    'Patterns',
    'Score',
    'Opinion',
    'ATR',
    'StopLoss',
    'TakeProfit',
    'TrailingStop',
    'TrailingStart'
  ].join(',');

  let csv = '';
  if (!fileExists) {
    csv += header + '\n';
  }

  for (const item of data) {
    csv += await formatCsvRow(item);
  }

  await fs.appendFile(filePath, csv, { encoding: 'utf-8' });
  logger.info(`[CSV written] ${filePath}`);
}