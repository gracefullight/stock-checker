import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

// Absolute path to packages/core/public — works regardless of CWD
const CSV_DIR = path.join(fileURLToPath(new URL('.', import.meta.url)), '../../public');

export interface SignalPoint {
  date: string; // YYYY-MM-DD
  opinion: 'BUY' | 'SELL' | 'HOLD';
}

interface CsvRow {
  Date: string;
  Ticker: string;
  Opinion: string;
}

export function getSignalHistory(ticker: string, fromDate: string): SignalPoint[] {
  const fromYYYYMM = fromDate.replace(/-/g, '').slice(0, 6);

  let files: string[];
  try {
    files = fs
      .readdirSync(CSV_DIR)
      .filter((f) => f.startsWith('stock_data_') && f.endsWith('.csv'))
      .filter((f) => {
        const yyyymm = f.replace('stock_data_', '').replace('.csv', '');
        return yyyymm >= fromYYYYMM;
      })
      .sort();
  } catch {
    return [];
  }

  const points: SignalPoint[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(CSV_DIR, file), 'utf-8');
      const rows = parse(content, { columns: true, skip_empty_lines: true }) as CsvRow[];
      for (const row of rows) {
        if (row.Ticker !== ticker) continue;
        if (row.Date < fromDate) continue;
        if (row.Opinion === 'BUY' || row.Opinion === 'SELL' || row.Opinion === 'HOLD') {
          points.push({ date: row.Date, opinion: row.Opinion as SignalPoint['opinion'] });
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return points;
}
