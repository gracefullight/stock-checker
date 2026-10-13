import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Saved state of one 09:00 Australia/Sydney daily screening run. */
export interface DailyReportState {
  localDate: string;
  status:
    | 'running'
    | 'completed'
    | 'partial'
    | 'unavailable'
    | 'paused'
    | 'failed'
    | 'disabled'
    | 'skipped';
  reason: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  jobId: string | null;
  /** Latest completed NYSE session the run evaluated; absent in older state files. */
  usSession?: string | null;
  window?: string;
  source?: string;
  universeSource?: string | null;
  collectedCount: number;
  sourceTotal: number | null;
  completeness: 'complete' | 'partial' | null;
  analyzedCount: number;
  matchedCount: number;
  notificationStatus: string | null;
}

/** Returns the latest run (no date) or the run saved for a local date; null when none exists. */
export type DailyReportReader = (date?: string) => Promise<DailyReportState | null>;

export const DAILY_REPORT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Same store the core daily-report command writes: <repo>/data/daily-reports/<date>.state.json.
// TODO(post-merge): replace with a core reader if one is exported (readDailyReportStatus only exposes the latest run).
const DAILY_REPORT_ROOT = fileURLToPath(new URL('../../../data/daily-reports/', import.meta.url));

function isDailyReportState(value: unknown): value is DailyReportState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.localDate === 'string' &&
    typeof state.status === 'string' &&
    (state.startedAt === null || typeof state.startedAt === 'string') &&
    (state.updatedAt === null || typeof state.updatedAt === 'string') &&
    (state.jobId === null || typeof state.jobId === 'string') &&
    typeof state.collectedCount === 'number' &&
    typeof state.analyzedCount === 'number' &&
    typeof state.matchedCount === 'number'
  );
}

export async function readDailyReport(date?: string): Promise<DailyReportState | null> {
  if (date === undefined) {
    const core = await import('@stock-checker/core/src/commands/daily-report.ts');
    const status = await core.readDailyReportStatus();
    return status.lastRun ?? null;
  }
  if (!DAILY_REPORT_DATE_PATTERN.test(date)) {
    throw new TypeError('date must use the YYYY-MM-DD form of the Australia/Sydney local date.');
  }
  const store = await import('@stock-checker/core/src/reports/market-screen-store.ts');
  let saved: unknown;
  try {
    saved = await store.readMarketScreenJson(path.join(DAILY_REPORT_ROOT, `${date}.state.json`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!isDailyReportState(saved)) throw new TypeError(`Saved daily report for ${date} is invalid.`);
  return saved;
}
