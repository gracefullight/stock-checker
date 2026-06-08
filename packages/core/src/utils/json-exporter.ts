import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import pino from 'pino';
import { CSV_DIR } from '@/constants';
import type { TickerResult } from '@/types';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
});

export async function exportToJson(data: TickerResult[]): Promise<void> {
  if (data.length === 0) {
    logger.info('No data to export to JSON');
    return;
  }

  const filePath = join(CSV_DIR, `stock_data_${DateTime.now().toFormat('yyyyLLdd')}.json`);
  const jsonOutput = JSON.stringify(data, null, 2);

  try {
    await fs.mkdir(CSV_DIR, { recursive: true });
    await fs.writeFile(filePath, jsonOutput, 'utf-8');
    logger.info(`[JSON exported] ${filePath}`);
  } catch (error) {
    logger.error({ error, filePath }, 'Failed to export JSON');
  }
}
