import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import { strategyConfigFingerprint } from '@/utils/config-fingerprint';

// Absolute path to packages/core/public — works regardless of CWD
const CSV_DIR = path.join(fileURLToPath(new URL('.', import.meta.url)), '../../public');

/**
 * First session the frozen leader-pullback configuration was validated on.
 * Rows before it were produced by earlier strategy versions and carry no
 * configuration fingerprint, so they describe a strategy that no longer runs.
 */
export const SIGNAL_HISTORY_VALIDATED_FROM = '2026-10-06';

export interface SignalPoint {
  date: string; // YYYY-MM-DD
  opinion: 'BUY' | 'SELL' | 'HOLD';
  /** Present only when legacy rows are requested explicitly. */
  legacy?: true;
}

export interface SignalHistoryOptions {
  /** Fingerprint the current strategy runs with; defaults to the shipped configuration. */
  configSha256?: string;
  /** Return rows from retired strategy versions, marked `legacy: true`. */
  includeLegacy?: boolean;
  /** Test-only override of the CSV directory. */
  directory?: string;
}

interface CsvRow {
  Date: string;
  Ticker: string;
  Opinion: string;
  ConfigSha256?: string;
}

let defaultFingerprint: string | undefined;
function currentFingerprint(): string {
  defaultFingerprint ??= strategyConfigFingerprint(DEFAULT_QUALITY_PIPELINE_CONFIG);
  return defaultFingerprint;
}

/**
 * Chart markers from the committed prediction CSVs. Monthly files were written
 * by several strategy versions with different column counts, duplicate
 * (Date, Ticker) rows and no fingerprint before 2026-10-14, so the reader
 * tolerates ragged rows, keeps the last row per (Date, Ticker) and, by
 * default, returns only rows the current configuration produced.
 */
export function getSignalHistory(
  ticker: string,
  fromDate: string,
  options: SignalHistoryOptions = {}
): SignalPoint[] {
  const directory = options.directory ?? CSV_DIR;
  const configSha256 = options.configSha256 ?? currentFingerprint();
  const fromYYYYMM = fromDate.replace(/-/g, '').slice(0, 6);

  let files: string[];
  try {
    files = fs
      .readdirSync(directory)
      .filter((f) => f.startsWith('stock_data_') && f.endsWith('.csv'))
      .filter((f) => {
        const yyyymm = f.replace('stock_data_', '').replace('.csv', '');
        return yyyymm >= fromYYYYMM;
      })
      .sort();
  } catch {
    return [];
  }

  const latest = new Map<string, SignalPoint>();

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(directory, file), 'utf-8');
      const rows = parse(content, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
      }) as CsvRow[];
      for (const row of rows) {
        if (row.Ticker !== ticker) continue;
        if (typeof row.Date !== 'string' || row.Date < fromDate) continue;
        if (row.Opinion !== 'BUY' && row.Opinion !== 'SELL' && row.Opinion !== 'HOLD') continue;
        const sha = row.ConfigSha256?.trim();
        // Rows written between the validation date and the fingerprint column's
        // introduction carry no fingerprint but came from the same frozen default.
        const legacy =
          row.Date < SIGNAL_HISTORY_VALIDATED_FROM || (sha ? sha !== configSha256 : false);
        if (legacy && !options.includeLegacy) {
          latest.delete(row.Date);
          continue;
        }
        latest.set(row.Date, {
          date: row.Date,
          opinion: row.Opinion as SignalPoint['opinion'],
          ...(legacy ? { legacy: true as const } : {}),
        });
      }
    } catch {
      // skip unreadable files
    }
  }

  return [...latest.values()].sort((left, right) => left.date.localeCompare(right.date));
}
