import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { DateTime } from 'luxon';
import pino from 'pino';
import { CSV_DIR } from '@/constants';
import type { TickerResult } from '@/types';
import { strategyConfigFingerprint } from '@/utils/config-fingerprint';
import { CANONICAL_STRATEGY_ID, loadPipelineConfig } from '@/utils/config-loader';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
});

export const CSV_HEADER = [
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
  'TrailingStart',
  'MACD',
  'MACDSignal',
  'MACDHistogram',
  'SMA20',
  'EMA20',
  'SMA50',
  'SMA200',
  'VolumeRatio',
  'TrendRegime',
  'ConfluenceRatio',
  'InstitutionalScore',
  'InstitutionalPassed',
  'StrategyId',
  'ConfigSha256',
] as const;

export interface CsvWriterOptions {
  /** Strategy identity stamped on every row; defaults to the loaded pipeline configuration. */
  strategyId?: string;
  configSha256?: string;
  /** Test-only override of the CSV directory. */
  directory?: string;
  /** Test-only override of the month file (yyyyLL). */
  month?: string;
}

function formatCsvRow(item: TickerResult, strategyId: string, configSha256: string): string[] {
  return [
    item.date,
    item.ticker,
    item.close.toFixed(2),
    String(item.volume),
    item.rsi.toFixed(2),
    item.stochasticK.toFixed(2),
    item.bbLower.toFixed(2),
    item.bbUpper.toFixed(2),
    item.donchLower.toFixed(2),
    item.donchUpper.toFixed(2),
    item.williamsR.toFixed(2),
    item.fearGreed === null || item.fearGreed === undefined ? '' : String(item.fearGreed),
    item.patterns.join('|'),
    item.score.toFixed(2),
    item.opinion,
    item.atr.toFixed(2),
    item.stopLoss.toFixed(2),
    item.takeProfit.toFixed(2),
    item.trailingStop.toFixed(2),
    item.trailingStart.toFixed(2),
    item.macd?.toFixed(2) ?? '',
    item.macdSignal?.toFixed(2) ?? '',
    item.macdHistogram?.toFixed(2) ?? '',
    item.sma20?.toFixed(2) ?? '',
    item.ema20?.toFixed(2) ?? '',
    item.sma50 != null && Number.isFinite(item.sma50) ? item.sma50.toFixed(2) : '',
    item.sma200 != null && Number.isFinite(item.sma200) ? item.sma200.toFixed(2) : '',
    item.volumeRatio?.toFixed(2) ?? '',
    item.trendRegime ?? '',
    item.confluenceRatio?.toFixed(2) ?? '',
    item.institutionalScore?.toFixed(2) ?? '',
    item.institutionalPassed != null ? String(item.institutionalPassed) : '',
    strategyId,
    configSha256,
  ];
}

const rowKey = (row: readonly string[]) => `${row[0]}\u0000${row[1]}\u0000${row[33] ?? ''}`;

/**
 * Upserts prediction rows into the month file on (Date, Ticker, ConfigSha256)
 * so a rerun for the same session replaces its earlier row instead of
 * appending a duplicate. Older rows with fewer columns are padded, never
 * reinterpreted, so earlier strategy versions stay distinguishable by their
 * empty fingerprint.
 */
export async function writeToCsv(
  data: TickerResult[],
  options: CsvWriterOptions = {}
): Promise<void> {
  if (data.length === 0) {
    logger.info('No data to write to CSV');
    return;
  }
  let strategyId = options.strategyId;
  let configSha256 = options.configSha256;
  if (!strategyId || !configSha256) {
    const config = await loadPipelineConfig();
    strategyId ??= CANONICAL_STRATEGY_ID;
    configSha256 ??= strategyConfigFingerprint(config);
  }

  const directory = options.directory ?? CSV_DIR;
  if (!existsSync(directory)) {
    await fs.mkdir(directory, { recursive: true });
  }
  const month = options.month ?? DateTime.now().toFormat('yyyyLL');
  const filePath = path.join(directory, `stock_data_${month}.csv`);

  const existing: string[][] = [];
  if (existsSync(filePath)) {
    const content = await fs.readFile(filePath, 'utf-8');
    const rows = parse(content, { skip_empty_lines: true, relax_column_count: true }) as string[][];
    for (const row of rows.slice(1)) {
      // Pad legacy rows to the current width; their fingerprint stays empty.
      existing.push([...row, ...Array(Math.max(0, CSV_HEADER.length - row.length)).fill('')]);
    }
  }

  const byKey = new Map(existing.map((row) => [rowKey(row), row]));
  for (const item of data) {
    const row = formatCsvRow(item, strategyId, configSha256);
    byKey.set(rowKey(row), row);
  }

  const csv = [CSV_HEADER.join(','), ...[...byKey.values()].map((row) => row.join(','))].join('\n');
  await fs.writeFile(filePath, `${csv}\n`, { encoding: 'utf-8' });
  logger.info(`[CSV written] ${filePath}`);
}
