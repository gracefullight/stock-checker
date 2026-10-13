import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TICKER_SECTOR_ETF } from '@/constants/tickers';
import { buildPositionPlan, type PositionPlan } from '@/positions/plan';
import { readMarketScreenJson, writeMarketScreenJson } from '@/reports/market-screen-store';
import { isSession, latestCompletedSession } from '@/utils/us-market-calendar';

export interface PositionFill {
  price: number;
  size: number;
  recordedAt: string;
  note: string | null;
}

export interface PositionClose {
  price: number;
  /** Latest completed session when the close was recorded. */
  session: string | null;
  recordedAt: string;
  note: string | null;
}

export interface PositionReference {
  price: number;
  stopLoss: number | null;
  takeProfit: number | null;
  atr: number | null;
}

export type PositionSource =
  | {
      kind: 'daily-report';
      jobId: string;
      recommendationIndex: number;
      /** When the WhatsApp gateway accepted the message that carried this BUY. */
      notifiedAt: string;
      universe: string;
    }
  | { kind: 'manual'; createdBy: 'cli' };

export interface PositionEntry {
  schemaVersion: 1;
  /** `${ticker}:${signalSession}`; one position per signal session regardless of repeated sends. */
  key: string;
  ticker: string;
  signalSession: string;
  source: PositionSource;
  /** Membership in the static validated universe (the measured 538-ticker population). */
  validatedUniverse: boolean;
  /** False keeps the row visible but out of reminders and sizing. */
  inPlan: boolean;
  plan: PositionPlan;
  reference: PositionReference | null;
  fill: PositionFill | null;
  close: PositionClose | null;
  createdAt: string;
  updatedAt: string;
}

export interface PositionLedgerDependencies {
  /** Test/CLI-only roots; public transports never accept filesystem paths. */
  positionsRootDirectory?: string;
  marketRootDirectory?: string;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export interface PositionLedger {
  entries: PositionEntry[];
  /** Files under the ledger root that could not be parsed as positions. */
  unreadable: number;
}

export interface PositionSyncResult {
  created: PositionEntry[];
  scannedJobs: number;
  skippedJobs: number;
}

interface SyncIndex {
  schemaVersion: 1;
  jobs: Record<string, { syncedAt: string; created: number }>;
}

interface SavedMatchLike {
  index: number;
  kind: string;
  completedAt: string;
  item: {
    ticker: string;
    dataAsOf: string | null;
    decision: string;
    validatedUniverse?: unknown;
    execution?: {
      reference?: {
        price?: unknown;
        stopLoss?: unknown;
        takeProfit?: unknown;
        atr?: unknown;
      } | null;
    };
  };
  forwardPerformance?: { status: string; reason: string | null; sessions: string[] } | null;
}

const PROJECT_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DEFAULT_POSITIONS_ROOT = path.join(PROJECT_ROOT, 'data/positions');
const DEFAULT_MARKET_ROOT = path.join(PROJECT_ROOT, 'data/market-scans');
const JOB_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TICKER = /^\^?[A-Z0-9]+(?:[.-][A-Z0-9]+)*(?:=[A-Z0-9]+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SYNC_INDEX = '.sync.json';
const UNSENT_JOB_GRACE_MS = 30 * 86_400_000;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function positionsRootDirectory(dependencies: PositionLedgerDependencies = {}): string {
  const root = path.resolve(dependencies.positionsRootDirectory ?? DEFAULT_POSITIONS_ROOT);
  if (!path.isAbsolute(root)) throw new TypeError('Position ledger must use an absolute path');
  return root;
}

export function marketRootDirectory(dependencies: PositionLedgerDependencies = {}): string {
  return path.resolve(dependencies.marketRootDirectory ?? DEFAULT_MARKET_ROOT);
}

export function positionKey(ticker: string, signalSession: string): string {
  return `${ticker}:${signalSession}`;
}

export function normalizeTicker(value: string): string {
  const ticker = value.trim().toUpperCase();
  if (ticker.length < 1 || ticker.length > 32 || !TICKER.test(ticker))
    throw new TypeError('ticker must be a valid market symbol');
  return ticker;
}

export function normalizeSession(value: string): string {
  const session = value.trim();
  if (!ISO_DATE.test(session) || !isSession(session))
    throw new TypeError('session must be a verified NYSE session date (YYYY-MM-DD, 2026–2028)');
  return session;
}

/** The static sector map is the measured population; Finviz-only names fall outside it. */
export function isValidatedUniverseTicker(ticker: string): boolean {
  return Object.hasOwn(TICKER_SECTOR_ETF, ticker);
}

export function includesUnvalidatedPositions(environment: NodeJS.ProcessEnv): boolean {
  return /^(?:1|true|yes)$/i.test(environment.POSITIONS_INCLUDE_UNVALIDATED?.trim() ?? '');
}

function entryFile(root: string, key: string): string {
  // Keys stay readable; characters outside [A-Z0-9.-:] are percent-encoded.
  return path.join(root, `${encodeURIComponent(key).replace(/%3A/gi, '_')}.json`);
}

function isEntry(value: unknown): value is PositionEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as PositionEntry;
  return (
    entry.schemaVersion === 1 &&
    typeof entry.ticker === 'string' &&
    TICKER.test(entry.ticker) &&
    typeof entry.signalSession === 'string' &&
    ISO_DATE.test(entry.signalSession) &&
    entry.key === positionKey(entry.ticker, entry.signalSession) &&
    !!entry.plan &&
    Array.isArray(entry.plan.sessions) &&
    typeof entry.inPlan === 'boolean' &&
    typeof entry.validatedUniverse === 'boolean' &&
    (entry.fill === null || (finite(entry.fill?.price) && finite(entry.fill?.size))) &&
    (entry.close === null || finite(entry.close?.price))
  );
}

export async function readPositionLedger(
  dependencies: PositionLedgerDependencies = {}
): Promise<PositionLedger> {
  const root = positionsRootDirectory(dependencies);
  let names: string[];
  try {
    names = (await readdir(root)).filter((name) => /^[^.].*\.json$/.test(name));
  } catch (error) {
    if (missing(error)) return { entries: [], unreadable: 0 };
    throw error;
  }
  const entries: PositionEntry[] = [];
  let unreadable = 0;
  for (const name of names.sort()) {
    try {
      const value = await readMarketScreenJson(path.join(root, name));
      if (isEntry(value)) entries.push(value);
      else unreadable++;
    } catch {
      unreadable++;
    }
  }
  entries.sort(
    (left, right) =>
      right.signalSession.localeCompare(left.signalSession) ||
      left.ticker.localeCompare(right.ticker)
  );
  return { entries, unreadable };
}

export async function writePositionEntry(
  entry: PositionEntry,
  dependencies: PositionLedgerDependencies = {}
): Promise<void> {
  if (!isEntry(entry)) throw new TypeError('Invalid position entry');
  await writeMarketScreenJson(entryFile(positionsRootDirectory(dependencies), entry.key), entry);
}

async function readSyncIndex(root: string): Promise<SyncIndex> {
  try {
    const value = (await readMarketScreenJson(path.join(root, SYNC_INDEX))) as SyncIndex;
    if (value?.schemaVersion === 1 && value.jobs && typeof value.jobs === 'object') return value;
  } catch (error) {
    if (!missing(error)) throw error;
  }
  return { schemaVersion: 1, jobs: {} };
}

function reference(item: SavedMatchLike['item']): PositionReference | null {
  const saved = item.execution?.reference;
  if (!saved || !finite(saved.price) || saved.price <= 0) return null;
  return {
    price: saved.price,
    stopLoss: finite(saved.stopLoss) ? saved.stopLoss : null,
    takeProfit: finite(saved.takeProfit) ? saved.takeProfit : null,
    atr: finite(saved.atr) ? saved.atr : null,
  };
}

function registrationReason(status: string, reason: string | null): string {
  if (status === 'ineligible')
    return '발송 시점에 진입 시가가 지났거나 완료 세션 신호가 아니어서 계획에서 제외됐습니다.';
  if (status === 'unavailable')
    return '검증된 NYSE 달력 밖이거나 신호 시각을 확인할 수 없어 계획에서 제외됐습니다.';
  return reason ?? '계획에서 제외됐습니다.';
}

function entryFromMatch(
  jobId: string,
  universe: string,
  saved: SavedMatchLike,
  notifiedAt: string,
  includeUnvalidated: boolean,
  now: string
): PositionEntry | null {
  const item = saved.item;
  if (
    item?.decision !== 'BUY' ||
    typeof item.ticker !== 'string' ||
    !TICKER.test(item.ticker) ||
    typeof item.dataAsOf !== 'string' ||
    !ISO_DATE.test(item.dataAsOf) ||
    !Number.isInteger(saved.index)
  )
    return null;
  const plan = buildPositionPlan(item.dataAsOf);
  const registration = saved.forwardPerformance ?? null;
  if (plan.status === 'planned' && registration && registration.status !== 'pending') {
    plan.status = 'unavailable';
    plan.reason = registrationReason(registration.status, registration.reason);
  }
  const validatedUniverse =
    typeof item.validatedUniverse === 'boolean'
      ? item.validatedUniverse
      : isValidatedUniverseTicker(item.ticker);
  return {
    schemaVersion: 1,
    key: positionKey(item.ticker, item.dataAsOf),
    ticker: item.ticker,
    signalSession: item.dataAsOf,
    source: {
      kind: 'daily-report',
      jobId,
      recommendationIndex: saved.index,
      notifiedAt,
      universe,
    },
    validatedUniverse,
    inPlan: plan.status === 'planned' && (validatedUniverse || includeUnvalidated),
    plan,
    reference: reference(item),
    fill: null,
    close: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Creates ledger rows from BUY recommendations the daily report actually delivered:
 * a saved market-scan job whose notification.json result is `accepted`. Rows are
 * keyed by ticker + signal session, so weekend re-sends never duplicate a position.
 */
export async function syncPositionsFromMarketScans(
  dependencies: PositionLedgerDependencies = {},
  options: { excludeJobId?: string | null } = {}
): Promise<PositionSyncResult> {
  const root = positionsRootDirectory(dependencies);
  const market = marketRootDirectory(dependencies);
  const environment = dependencies.environment ?? process.env;
  const nowIso = (dependencies.now ?? (() => new Date()))().toISOString();
  const includeUnvalidated = includesUnvalidatedPositions(environment);
  const result: PositionSyncResult = { created: [], scannedJobs: 0, skippedJobs: 0 };
  let jobIds: string[];
  try {
    jobIds = (await readdir(market, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && JOB_ID.test(entry.name))
      .map((entry) => entry.name.toLowerCase())
      .sort();
  } catch (error) {
    if (missing(error)) return result;
    throw error;
  }
  const index = await readSyncIndex(root);
  const ledger = await readPositionLedger(dependencies);
  const known = new Set(ledger.entries.map((entry) => entry.key));
  let indexChanged = false;
  for (const jobId of jobIds) {
    if (index.jobs[jobId] || jobId === options.excludeJobId?.toLowerCase()) {
      result.skippedJobs++;
      continue;
    }
    result.scannedJobs++;
    let notification: {
      attemptedAt?: string;
      finishedAt?: string | null;
      result?: { status?: string } | null;
    };
    try {
      notification = (await readMarketScreenJson(
        path.join(market, jobId, 'notification.json')
      )) as typeof notification;
    } catch (error) {
      if (!missing(error)) continue;
      // Never-notified jobs stay eligible for a while; stale ones stop being re-read.
      try {
        const state = (await readMarketScreenJson(path.join(market, jobId, 'state.json'))) as {
          createdAt?: string;
        };
        const createdAt = Date.parse(state?.createdAt ?? '');
        if (Number.isFinite(createdAt) && Date.parse(nowIso) - createdAt > UNSENT_JOB_GRACE_MS) {
          index.jobs[jobId] = { syncedAt: nowIso, created: 0 };
          indexChanged = true;
        }
      } catch {
        /* Unreadable jobs are retried on the next sync. */
      }
      continue;
    }
    if (!notification?.result) continue; // A send is still in flight.
    let created = 0;
    if (notification.result.status === 'accepted') {
      let universe = 'unknown';
      try {
        const state = (await readMarketScreenJson(path.join(market, jobId, 'state.json'))) as {
          universe?: { source?: string };
        };
        if (typeof state?.universe?.source === 'string') universe = state.universe.source;
      } catch {
        /* The universe label is informational only. */
      }
      const notifiedAt = notification.finishedAt ?? notification.attemptedAt ?? nowIso;
      let names: string[] = [];
      try {
        names = (await readdir(path.join(market, jobId, 'results/matches'))).filter((name) =>
          /^\d{8}\.json$/.test(name)
        );
      } catch (error) {
        if (!missing(error)) continue;
      }
      for (const name of names.sort()) {
        let saved: SavedMatchLike;
        try {
          saved = (await readMarketScreenJson(
            path.join(market, jobId, 'results/matches', name)
          )) as SavedMatchLike;
        } catch {
          continue;
        }
        const entry = entryFromMatch(
          jobId,
          universe,
          saved,
          notifiedAt,
          includeUnvalidated,
          nowIso
        );
        if (!entry || known.has(entry.key)) continue;
        await writePositionEntry(entry, dependencies);
        known.add(entry.key);
        result.created.push(entry);
        created++;
      }
    }
    index.jobs[jobId] = { syncedAt: nowIso, created };
    indexChanged = true;
  }
  if (indexChanged) await writeMarketScreenJson(path.join(root, SYNC_INDEX), index);
  return result;
}

async function findEntry(
  ticker: string,
  signalSession: string,
  dependencies: PositionLedgerDependencies
): Promise<PositionEntry | null> {
  try {
    const value = await readMarketScreenJson(
      entryFile(positionsRootDirectory(dependencies), positionKey(ticker, signalSession))
    );
    return isEntry(value) ? value : null;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function positive(value: number, name: string): number {
  if (!finite(value) || value <= 0) throw new TypeError(`${name} must be a positive number`);
  return value;
}

function note(value: string | undefined): string | null {
  if (value === undefined) return null;
  const clean = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu, ' ').trim();
  if (clean.length > 120) throw new TypeError('note must be at most 120 characters');
  return clean || null;
}

/** Records an actual entry fill; a missing row is created as a manual position. */
export async function recordPositionFill(
  input: { ticker: string; session: string; price: number; size: number; note?: string },
  dependencies: PositionLedgerDependencies = {}
): Promise<PositionEntry> {
  const ticker = normalizeTicker(input.ticker);
  const session = normalizeSession(input.session);
  const price = positive(input.price, 'price');
  const size = positive(input.size, 'size');
  const nowIso = (dependencies.now ?? (() => new Date()))().toISOString();
  const existing = await findEntry(ticker, session, dependencies);
  const entry: PositionEntry = existing ?? {
    schemaVersion: 1,
    key: positionKey(ticker, session),
    ticker,
    signalSession: session,
    source: { kind: 'manual', createdBy: 'cli' },
    validatedUniverse: isValidatedUniverseTicker(ticker),
    inPlan: true,
    plan: buildPositionPlan(session),
    reference: null,
    fill: null,
    close: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  if (entry.close) throw new TypeError('This position is already closed');
  entry.fill = { price, size, recordedAt: nowIso, note: note(input.note) };
  entry.inPlan = entry.plan.status === 'planned';
  entry.updatedAt = nowIso;
  await writePositionEntry(entry, dependencies);
  return entry;
}

/** Records the actual exit; the row stays in the ledger as a closed position. */
export async function closePosition(
  input: { ticker: string; session: string; price: number; note?: string },
  dependencies: PositionLedgerDependencies = {}
): Promise<PositionEntry> {
  const ticker = normalizeTicker(input.ticker);
  const session = normalizeSession(input.session);
  const price = positive(input.price, 'price');
  const now = (dependencies.now ?? (() => new Date()))();
  const entry = await findEntry(ticker, session, dependencies);
  if (!entry) throw new TypeError('No position exists for this ticker and signal session');
  if (entry.close) throw new TypeError('This position is already closed');
  entry.close = {
    price,
    session: latestCompletedSession(now),
    recordedAt: now.toISOString(),
    note: note(input.note),
  };
  entry.updatedAt = now.toISOString();
  await writePositionEntry(entry, dependencies);
  return entry;
}
