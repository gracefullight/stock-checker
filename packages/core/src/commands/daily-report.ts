import { constants, type Stats } from 'node:fs';
import { chmod, type FileHandle, lstat, mkdir, open, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pino from 'pino';
import { appendPositionDigest } from '@/positions/digest';
import {
  collectFinvizCandidates,
  defaultFinvizCollectionPlan,
  type FinvizCollectorOptions,
  isFinvizBrowserAvailable,
} from '@/reports/finviz-collector';
import {
  createMarketScreenJob,
  getMarketScreenJob,
  isMarketScreenJobTerminal,
  isMarketScreenLeaseBusy,
  type MarketScreenDependencies,
  type MarketScreenJob,
  type MarketScreenJobSnapshot,
  pauseMarketScreenJob,
  runMarketScreenJob,
} from '@/reports/market-screen';
import { writeMarketScreenJson } from '@/reports/market-screen-store';
import {
  classifyCollection,
  configuredUniverseCandidates,
  configuredUniverseProvenance,
  describeUniverseCoverage,
  estimateScanDuration,
  type MarketScreenCollectionStatus,
  type MarketScreenProvenance,
  type MarketScreenUniverseSource,
} from '@/reports/market-screen-universe';
import type { StockScreenMatch } from '@/reports/stock-screen';
import { formatMarketScreenTitle } from '@/utils/screening-diagnostics';
import {
  buildStockReportWhatsAppNotification,
  formatStockReportWhatsAppNotification,
  type StockReportAlertInput,
} from '@/utils/stock-report-alerts';
import { formatScreenTimestamp } from '@/utils/stock-screen-alerts';
import { latestCompletedSession, nextSessionOpen, sessionOpenAt } from '@/utils/us-market-calendar';
import {
  isWhatsAppNotificationConfigured,
  sendWhatsAppNotification,
  type WhatsAppNotification,
  type WhatsAppNotificationResult,
} from '@/utils/whatsapp';

export const DAILY_REPORT_TIMEZONE = 'Australia/Sydney';
export const DAILY_REPORT_START_WINDOW = '09:00–09:14';
export const DAILY_REPORT_LATE_WINDOW = '09:15 until 90 minutes before the next NYSE open';
const PROJECT_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const EXECUTION_BUDGET_MS = 20 * 60_000;
/** A manual screen or paper refresh may hold the single runner lease briefly. */
const LEASE_WAIT_MS = 5 * 60_000;
const LATE_CUTOFF_BEFORE_OPEN_MS = 90 * 60_000;
const SCAN_TERMINAL = new Set(['completed', 'partial']);
const logger = pino({ name: 'daily-stock-report' }, process.stderr);

export type DailyReportSource = MarketScreenUniverseSource;
export type DailyReportWindow = 'primary' | 'late';

export interface DailyReportDependencies {
  /** Local test/orchestration dependencies, never supplied through an MCP input. */
  rootDirectory?: string;
  marketRootDirectory?: string;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  collect?: typeof collectFinvizCandidates;
  isBrowserAvailable?: typeof isFinvizBrowserAvailable;
  isConfigured?: () => Promise<boolean>;
  send?: typeof sendWhatsAppNotification;
  buildReport?: typeof buildStockReportWhatsAppNotification;
  createJob?: typeof createMarketScreenJob;
  runJob?: typeof runMarketScreenJob;
  getJob?: typeof getMarketScreenJob;
  pauseJob?: typeof pauseMarketScreenJob;
  hasJobNotificationAttempt?: (id: string) => Promise<boolean>;
  marketDependencies?: MarketScreenDependencies;
  /** Offline universe injection for tests; production always uses the configured list. */
  configuredUniverse?: () => string[];
  executionBudgetMs?: number;
  leaseWaitMs?: number;
  leaseRetryMs?: number;
  pollIntervalMs?: number;
}

export type DailyRunStatus =
  | 'running'
  | 'completed'
  | 'partial'
  | 'unavailable'
  | 'paused'
  | 'failed'
  | 'disabled'
  | 'skipped';

export interface DailyRunCollection {
  /** `capped` is a configured Finviz limit; `partial`/`unavailable` are failures. */
  status: MarketScreenCollectionStatus | 'unavailable' | null;
  reason: string | null;
}

interface DailyRunState {
  schemaVersion: 2;
  localDate: string;
  timezone: string;
  window: DailyReportWindow;
  /** Latest completed NYSE session at run start; null outside the calendar. */
  usSession: string | null;
  startedAt: string;
  updatedAt: string;
  status: DailyRunStatus;
  reason: string | null;
  jobId: string | null;
  /** Requested lane and the universe that was actually scanned (after any fallback). */
  source: DailyReportSource;
  universeSource: DailyReportSource | null;
  collection: DailyRunCollection;
  collectedCount: number;
  sourceTotal: number | null;
  completeness: 'complete' | 'partial' | null;
  estimatedScanMs: number | null;
  analyzedCount: number;
  matchedCount: number;
  analysisStatus: 'complete' | 'degraded' | 'unavailable' | null;
  notificationStatus: WhatsAppNotificationResult['status'] | null;
}

/** Legacy (schemaVersion 1) states lack session and lane fields; readers tolerate both. */
type SavedRunState = Partial<DailyRunState> & Pick<DailyRunState, 'localDate' | 'status'>;

export function resolveDailyReportSource(environment: NodeJS.ProcessEnv): DailyReportSource {
  const raw = (environment.DAILY_REPORT_SOURCE ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'configured' || raw === 'configured-universe')
    return 'configured-universe';
  if (raw === 'finviz' || raw === 'finviz-candidates') return 'finviz-candidates';
  throw new TypeError('Invalid DAILY_REPORT_SOURCE; use configured or finviz');
}

export function dailyReportSchedule(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const minutes = Number(value('hour')) * 60 + Number(value('minute'));
  const primary = minutes >= 9 * 60 && minutes < 9 * 60 + 15;
  const nextOpen = nextSessionOpen(date);
  // Unknown calendar years fail closed: no catch-up without a verified next open.
  const lateUntil = nextOpen === null ? null : sessionOpenAt(nextOpen) - LATE_CUTOFF_BEFORE_OPEN_MS;
  const late =
    !primary && minutes >= 9 * 60 + 15 && lateUntil !== null && date.getTime() < lateUntil;
  const window: DailyReportWindow | null = primary ? 'primary' : late ? 'late' : null;
  return {
    timezone: DAILY_REPORT_TIMEZONE,
    localDate: `${value('year')}-${value('month')}-${value('day')}`,
    startWindow: DAILY_REPORT_START_WINDOW,
    lateWindow: DAILY_REPORT_LATE_WINDOW,
    window,
    eligible: window !== null,
    usSession: latestCompletedSession(date),
    nextSessionOpen: nextOpen,
    lateUntil: lateUntil === null ? null : new Date(lateUntil).toISOString(),
  };
}

export function parseDailyReportArguments(arguments_: string[]): 'run' | 'status' | 'dry-run' {
  if (arguments_.length === 0) return 'run';
  if (arguments_.length === 1 && arguments_[0] === '--status') return 'status';
  if (arguments_.length === 1 && arguments_[0] === '--dry-run') return 'dry-run';
  throw new TypeError(
    'Use --status or --dry-run; scheduled runs cannot bypass the Sydney start window.'
  );
}

function numberSetting(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  maximum: number
): number {
  const raw = environment[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}

function collectionSettings(environment: NodeJS.ProcessEnv): FinvizCollectorOptions {
  return {
    maxCandidates: numberSetting(environment, 'DAILY_REPORT_MAX_CANDIDATES', 200, 15_000),
    maxPages: numberSetting(environment, 'DAILY_REPORT_MAX_PAGES', 10, 30),
    timeBudgetMs: 60_000,
    minIntervalMs: 2_000,
    ...(environment.ASIDE_BIN ? { asideExecutable: environment.ASIDE_BIN } : {}),
  };
}

function directories(dependencies: DailyReportDependencies) {
  return {
    root: path.resolve(dependencies.rootDirectory ?? path.join(PROJECT_ROOT, 'data/daily-reports')),
    market: path.resolve(
      dependencies.marketRootDirectory ??
        dependencies.marketDependencies?.rootDirectory ??
        path.join(PROJECT_ROOT, 'data/market-scans')
    ),
  };
}

async function privateDirectory(directory: string): Promise<void> {
  const parent = path.dirname(directory);
  let information: Stats | undefined;
  try {
    information = await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (information) {
    if (!information.isDirectory() || information.isSymbolicLink())
      throw new Error('Unsafe daily-report directory');
  } else {
    if (parent !== directory) await privateDirectory(parent);
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const created = await lstat(directory);
    if (!created.isDirectory() || created.isSymbolicLink())
      throw new Error('Unsafe daily-report directory');
  }
}

async function exclusiveJson(file: string, value: unknown): Promise<boolean> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      file,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600
    );
    await handle.writeFile(JSON.stringify(value), 'utf8');
    await handle.sync();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function notificationWasAttempted(root: string, id: string): Promise<boolean> {
  if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id))
    throw new Error('Invalid market job');
  try {
    // Presence suffices: unknown or unfinished attempts must never be retried.
    await lstat(path.join(root, id, 'notification.json'));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function savedStates(root: string): Promise<SavedRunState[]> {
  let files: string[];
  try {
    files = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return [];
  }
  const states: SavedRunState[] = [];
  for (const file of files.filter((name) => /^\d{4}-\d{2}-\d{2}\.state\.json$/.test(name)).sort()) {
    try {
      const state = JSON.parse(await readFile(path.join(root, file), 'utf8')) as SavedRunState;
      if (state && typeof state.localDate === 'string') states.push(state);
    } catch {
      // A corrupt historical state never blocks or triggers a scan.
    }
  }
  return states;
}

/** The earlier local date whose delivered scan already covered this US session. */
export function priorRunCoveringSession(
  states: readonly SavedRunState[],
  localDate: string,
  usSession: string | null
): string | null {
  if (usSession === null) return null;
  const prior = states.find(
    (state) =>
      state.localDate !== localDate &&
      state.usSession === usSession &&
      SCAN_TERMINAL.has(state.status) &&
      state.notificationStatus === 'accepted'
  );
  return prior?.localDate ?? null;
}

export async function readDailyReportStatus(dependencies: DailyReportDependencies = {}) {
  const schedule = dailyReportSchedule((dependencies.now ?? (() => new Date()))());
  const { root } = directories(dependencies);
  const state = (await savedStates(root)).at(-1);
  if (!state) return { ...schedule, lastRun: null };
  return {
    ...schedule,
    lastRun: {
      localDate: state.localDate,
      window: state.window ?? 'primary',
      usSession: state.usSession ?? null,
      status: state.status,
      reason: state.reason ?? null,
      startedAt: state.startedAt ?? null,
      updatedAt: state.updatedAt ?? null,
      jobId: state.jobId ?? null,
      source: state.source ?? 'finviz-candidates',
      universeSource: state.universeSource ?? null,
      collection: state.collection ?? { status: null, reason: null },
      collectedCount: state.collectedCount ?? 0,
      sourceTotal: state.sourceTotal ?? null,
      completeness: state.completeness ?? null,
      analyzedCount: state.analyzedCount ?? 0,
      matchedCount: state.matchedCount ?? 0,
      analysisStatus: state.analysisStatus ?? null,
      notificationStatus: state.notificationStatus ?? null,
    },
  };
}

interface DailyTickMarker {
  status: string;
  reason: string | null;
  localDate: string | null;
}

/**
 * Scheduled ticks run every minute; skipped ticks are logged once per state change
 * instead of once per minute. Returns whether the caller should log this result.
 */
export async function shouldLogDailyTick(
  result: { status: string; reason?: string | null; localDate?: string | null },
  dependencies: DailyReportDependencies = {}
): Promise<boolean> {
  if (result.status !== 'skipped') return true;
  const { root } = directories(dependencies);
  const marker: DailyTickMarker = {
    status: result.status,
    reason: result.reason ?? null,
    localDate: result.localDate ?? null,
  };
  const file = path.join(root, '.last-tick.json');
  try {
    const previous = JSON.parse(await readFile(file, 'utf8')) as DailyTickMarker;
    if (
      previous.status === marker.status &&
      previous.reason === marker.reason &&
      previous.localDate === marker.localDate
    )
      return false;
  } catch {
    // Missing or unreadable marker: log and rewrite it.
  }
  try {
    await privateDirectory(root);
    await writeMarketScreenJson(file, marker);
  } catch {
    // Logging must not fail because the marker could not be saved.
  }
  return true;
}

export async function runDailyReport(
  options: { dryRun?: boolean } = {},
  dependencies: DailyReportDependencies = {}
) {
  const now = dependencies.now ?? (() => new Date());
  const schedule = dailyReportSchedule(now());
  const environment = dependencies.environment ?? process.env;
  const source = resolveDailyReportSource(environment);
  const budget = dependencies.executionBudgetMs ?? EXECUTION_BUDGET_MS;
  const minIntervalMs = dependencies.marketDependencies?.minIntervalMs ?? 1_000;
  const configuredUniverse = dependencies.configuredUniverse ?? configuredUniverseCandidates;
  if (options.dryRun) {
    const settings = collectionSettings(environment);
    const universeSize =
      source === 'configured-universe' ? configuredUniverse().length : settings.maxCandidates!;
    const estimate = estimateScanDuration(universeSize, { minIntervalMs });
    return {
      ...schedule,
      status: 'dry-run',
      source,
      universeSize,
      estimatedScanMs: estimate.estimatedMs,
      withinBudget: estimate.estimatedMs <= budget,
      maxCandidates: settings.maxCandidates,
      maxPages: settings.maxPages,
      collectionBudgetMs: settings.timeBudgetMs,
      executionBudgetMs: budget,
      finvizPlan: defaultFinvizCollectionPlan(),
      browserReady:
        source === 'finviz-candidates'
          ? await (dependencies.isBrowserAvailable ?? isFinvizBrowserAvailable)(settings)
          : null,
    };
  }
  if (!schedule.eligible)
    return { status: 'skipped', reason: 'outside-window', localDate: schedule.localDate };
  const window = schedule.window as DailyReportWindow;
  const { root, market } = directories(dependencies);
  await privateDirectory(root);
  await chmod(root, 0o700);
  const claim = {
    schemaVersion: 2 as const,
    localDate: schedule.localDate,
    timezone: DAILY_REPORT_TIMEZONE,
    window,
    usSession: schedule.usSession,
    startedAt: now().toISOString(),
  };
  if (!(await exclusiveJson(path.join(root, `${schedule.localDate}.claim.json`), claim))) {
    return { status: 'skipped', reason: 'already-claimed', localDate: schedule.localDate };
  }
  const state: DailyRunState = {
    ...claim,
    updatedAt: claim.startedAt,
    status: 'running',
    reason: null,
    jobId: null,
    source,
    universeSource: null,
    collection: { status: null, reason: null },
    collectedCount: 0,
    sourceTotal: null,
    completeness: null,
    estimatedScanMs: null,
    analyzedCount: 0,
    matchedCount: 0,
    analysisStatus: null,
    notificationStatus: null,
  };
  const save = async () => {
    state.updatedAt = now().toISOString();
    await writeMarketScreenJson(path.join(root, `${schedule.localDate}.state.json`), state);
  };
  const covered = priorRunCoveringSession(
    await savedStates(root),
    schedule.localDate,
    schedule.usSession
  );
  if (covered) {
    state.status = 'skipped';
    state.reason = 'no-new-session';
    await save();
    return { ...state, coveredBy: covered };
  }
  const prefix = window === 'late' ? '아침 스크리닝 (지연)' : '아침 스크리닝';
  const sessionLabel = state.usSession ? ` · 미국 세션 ${state.usSession}` : '';
  let dispatch: Promise<WhatsAppNotificationResult> | undefined;
  let latestJob: MarketScreenJob | undefined;
  const coverageLabel = () => {
    if (state.universeSource === null) return '';
    const universe = describeUniverseCoverage({
      source: state.universeSource,
      collectedCount: state.collectedCount,
      sourceTotal: state.sourceTotal ?? state.collectedCount,
    });
    return ` · ${universe}${state.jobId ? ` · 평가 ${state.analyzedCount}/${state.collectedCount}` : ''}`;
  };
  const sendOnce = async (
    notification: WhatsAppNotification | (() => Promise<WhatsAppNotification>)
  ): Promise<WhatsAppNotificationResult> => {
    if (dispatch) return dispatch;
    const dispatchFile = path.join(root, `${schedule.localDate}.dispatch.json`);
    const attempt = {
      schemaVersion: 1,
      localDate: schedule.localDate,
      attemptedAt: now().toISOString(),
      finishedAt: null,
    };
    if (!(await exclusiveJson(dispatchFile, attempt)))
      return { status: 'disabled', reason: 'not-configured' };
    dispatch = (async () => {
      let result: WhatsAppNotificationResult;
      try {
        let built = typeof notification === 'function' ? await notification() : notification;
        try {
          // The '보유 계획' section reads the local ledger only; it never blocks the report.
          built = await appendPositionDigest(built, {
            now: now(),
            environment,
            marketRootDirectory: market,
            positionsRootDirectory: path.join(path.dirname(market), 'positions'),
            currentJobId: state.jobId,
          });
        } catch {
          /* Position digest failures leave the screening message intact. */
        }
        if (state.jobId) {
          try {
            updateCounts(await get());
          } catch {
            /* Keep the last saved checkpoint counts. */
          }
        }
        result = await (dependencies.send ?? sendWhatsAppNotification)({
          ...built,
          title:
            latestJob && isMarketScreenJobTerminal(latestJob.status)
              ? `${formatMarketScreenTitle(latestJob, prefix)}${sessionLabel}`
              : `${built.title.replace(/^시장 후보 스크리닝/, prefix)}${coverageLabel()}${sessionLabel}`,
        });
      } catch {
        result = { status: 'failed', reason: 'network-error' };
      }
      state.notificationStatus = result.status;
      // Only delivery status is retained here; no recipient, token or message text.
      await writeMarketScreenJson(dispatchFile, {
        ...attempt,
        finishedAt: now().toISOString(),
        result: result.status,
      });
      return result;
    })();
    return dispatch;
  };
  const hasAttempt = () =>
    state.jobId
      ? (dependencies.hasJobNotificationAttempt ?? ((id) => notificationWasAttempted(market, id)))(
          state.jobId
        )
      : Promise.resolve(false);
  const fallback = async (title: string, summary: string) => {
    if (dispatch) {
      await dispatch;
      return;
    }
    if (await hasAttempt()) {
      state.reason = 'notification-already-attempted';
      return;
    }
    await sendOnce({
      title: `${prefix} · ${title}`,
      asOf: `${schedule.localDate} Sydney · ${formatScreenTimestamp(now().toISOString())}`,
      summary,
    });
  };
  const jobDependencies: MarketScreenDependencies = {
    ...dependencies.marketDependencies,
    rootDirectory: market,
    isWhatsAppNotificationConfigured: dependencies.isConfigured ?? isWhatsAppNotificationConfigured,
    sendWhatsAppNotification: (notification) => sendOnce(notification),
  };
  const get = () =>
    (dependencies.getJob ?? getMarketScreenJob)(
      state.jobId!,
      { kind: 'matches', limit: 3 },
      jobDependencies
    );
  const updateCounts = ({ job }: MarketScreenJobSnapshot) => {
    latestJob = job;
    state.analyzedCount = job.progress.analyzed;
    state.matchedCount = job.progress.matched;
    if (isMarketScreenJobTerminal(job.status)) {
      state.analysisStatus =
        job.outcome?.analysis ??
        (job.progress.analyzed === 0
          ? 'unavailable'
          : job.progress.unavailable > 0
            ? 'degraded'
            : 'complete');
    }
  };
  const fallbackForJob = async (
    current: MarketScreenJobSnapshot,
    title: string,
    summary: string
  ) => {
    if (dispatch) {
      await dispatch;
      return;
    }
    if (await hasAttempt()) {
      state.reason = 'notification-already-attempted';
      return;
    }
    await sendOnce(async () => {
      let saved = current;
      try {
        saved = await get();
      } catch {
        /* Use the last owned checkpoint. */
      }
      updateCounts(saved);
      const candidates = saved.page.items
        .filter((item): item is StockScreenMatch => 'decision' in item)
        .slice(0, 3)
        .map((match) => ({
          ticker: match.ticker,
          decision: match.decision,
          dataAsOf: match.dataAsOf,
          gateReasons: match.gateReasons,
          reference: match.execution.reference,
        }));
      // Provenance fields are read by newer formatters and ignored by older ones.
      const input: StockReportAlertInput & {
        usSession?: string | null;
        universeSource?: MarketScreenUniverseSource;
        jobId?: string;
      } = {
        title: `${prefix} · ${title}`,
        asOf: `${schedule.localDate} Sydney · 검색 중단 ${formatScreenTimestamp(now().toISOString())}`,
        lookbackDays: saved.job.criteria.lookbackDays,
        pipelineConfig: saved.job.criteria.pipelineConfig,
        candidates,
        usSession: state.usSession,
        universeSource: saved.job.universe.source,
        jobId: saved.job.id,
      };
      if (!candidates.length) return { title: input.title, asOf: input.asOf, summary };
      // Outstanding provider calls retain their slots after pause. Do not overlap
      // them with fresh history/target requests merely to enrich a fallback.
      return saved.job.progress.inFlight > 0
        ? formatStockReportWhatsAppNotification(input, [])
        : (dependencies.buildReport ?? buildStockReportWhatsAppNotification)(input);
    });
  };
  await save();
  try {
    if (!(await (dependencies.isConfigured ?? isWhatsAppNotificationConfigured)())) {
      state.status = 'disabled';
      state.reason = 'not-configured';
      state.notificationStatus = 'disabled';
      await save();
      return state;
    }
    const started = now().getTime();
    let tickers: string[] = [];
    let provenance: MarketScreenProvenance | null = null;
    let emptySource = false;
    if (source === 'finviz-candidates') {
      const collected = await (dependencies.collect ?? collectFinvizCandidates)(
        collectionSettings(environment)
      );
      state.collectedCount = collected.tickers.length;
      state.sourceTotal = collected.provenance?.sourceTotal ?? null;
      state.completeness = collected.provenance?.completeness ?? null;
      if (
        collected.status === 'unavailable' ||
        !collected.provenance ||
        (!collected.tickers.length && state.sourceTotal !== 0)
      ) {
        // A browser or Finviz failure must not erase the trading day: scan the
        // validated universe instead and record why the discovery lane was skipped.
        state.collection = { status: 'unavailable', reason: collected.reason ?? 'browser-error' };
        state.reason = 'finviz-fallback';
      } else if (collected.tickers.length === 0) {
        state.collection = { status: 'complete', reason: null };
        state.universeSource = 'finviz-candidates';
        emptySource = true;
      } else {
        state.collection = {
          status: classifyCollection({
            completeness: collected.provenance.completeness,
            collectionReason: collected.reason,
          }),
          reason: collected.reason,
        };
        state.universeSource = 'finviz-candidates';
        tickers = collected.tickers;
        provenance = { ...collected.provenance, collectionReason: collected.reason };
      }
      await save();
    }
    if (!emptySource && state.universeSource !== 'finviz-candidates') {
      tickers = configuredUniverse();
      provenance = configuredUniverseProvenance(now());
      state.universeSource = 'configured-universe';
      state.collectedCount = tickers.length;
      state.sourceTotal = tickers.length;
      state.completeness = 'complete';
      if (state.collection.status === null) state.collection = { status: 'complete', reason: null };
      await save();
    }
    if (emptySource) {
      state.status = 'completed';
      await fallback('BUY · 후보 없음', '일치 종목 없음.');
    } else if (!tickers.length || !provenance) {
      state.status = 'unavailable';
      state.reason = 'collection-unavailable';
      await fallback(
        '수집 실패',
        '후보 종목을 가져오지 못했습니다. 오늘 분석은 시작하지 않았습니다.'
      );
    } else {
      const estimate = estimateScanDuration(tickers.length, { minIntervalMs });
      state.estimatedScanMs = estimate.estimatedMs;
      if (estimate.estimatedMs > budget) {
        logger.warn(
          { candidates: tickers.length, estimatedMs: estimate.estimatedMs, budgetMs: budget },
          '예상 평가 시간이 실행 기한을 초과합니다. 기한 도달 시 평가를 중단합니다.'
        );
      }
      let current = await (dependencies.createJob ?? createMarketScreenJob)(
        {
          tickers,
          provenance,
          decision: 'BUY',
          lookbackDays: 730,
          autoStart: false,
          usSession: state.usSession,
        },
        jobDependencies
      );
      state.jobId = current.job.id;
      updateCounts(current);
      await save();
      const sleep =
        dependencies.sleep ??
        ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
      const run = () => (dependencies.runJob ?? runMarketScreenJob)(state.jobId!, jobDependencies);
      current = await run();
      updateCounts(current);
      // Another screen or a paper refresh may hold the single global lease for a
      // short while. Wait briefly instead of giving up the morning report.
      const leaseDeadline = started + Math.min(dependencies.leaseWaitMs ?? LEASE_WAIT_MS, budget);
      while (
        current.job.status === 'paused' &&
        isMarketScreenLeaseBusy(current.job.pauseReason) &&
        now().getTime() < leaseDeadline
      ) {
        state.reason = 'lease-wait';
        await save();
        await sleep(dependencies.leaseRetryMs ?? 5_000);
        current = await run();
        updateCounts(current);
      }
      if (state.reason === 'lease-wait' && !isMarketScreenLeaseBusy(current.job.pauseReason))
        state.reason = null;
      while (current.job.status === 'running' || current.job.status === 'queued') {
        if (now().getTime() - started >= budget) {
          await (dependencies.pauseJob ?? pauseMarketScreenJob)(state.jobId, jobDependencies);
          state.status = 'paused';
          state.reason = 'execution-deadline';
          await fallbackForJob(
            current,
            '평가 기한 도달',
            `20분 평가 기한에 도달해 새 종목 분석을 중단했습니다. 진행 중 분석과 저장 결과는 보존됩니다.`
          );
          break;
        }
        await sleep(dependencies.pollIntervalMs ?? 1000);
        current = await get();
        updateCounts(current);
      }
      if (state.status !== 'paused') {
        state.status =
          current.job.status === 'paused'
            ? 'paused'
            : isMarketScreenJobTerminal(current.job.status)
              ? (current.job.status as 'completed' | 'partial' | 'unavailable')
              : 'failed';
        if (state.status === 'paused') {
          state.reason = 'job-paused';
          await fallbackForJob(
            current,
            '평가 중단',
            '시장 스크리닝이 중단되었습니다. 저장 결과는 보존됩니다.'
          );
        } else {
          // The market notifier records its own attempt before enrichment. Wait
          // for that path; a terminal state alone never authorizes a second send.
          const notificationDeadline = now().getTime() + 60_000;
          while (!dispatch && now().getTime() < notificationDeadline) {
            await sleep(dependencies.pollIntervalMs ?? 1000);
          }
          if (dispatch) await dispatch;
          else
            await fallback(
              '발송 결과 확인 불가',
              '스크리닝 결과는 저장됐지만 알림 처리 결과를 확인하지 못했습니다.'
            );
        }
      }
    }
  } catch {
    state.status = 'failed';
    state.reason = 'daily-report-failed';
    if (state.jobId)
      await (dependencies.pauseJob ?? pauseMarketScreenJob)(state.jobId, jobDependencies).catch(
        () => {}
      );
    await fallback(
      '작업 실패',
      '아침 스크리닝 작업을 완료하지 못했습니다. 저장된 분석 결과는 보존됩니다.'
    ).catch(() => {});
  }
  await save();
  return state;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void (async () => {
    const mode = parseDailyReportArguments(process.argv.slice(2));
    if (mode === 'run') {
      const result = await runDailyReport();
      if (await shouldLogDailyTick(result)) logger.info(result, '일일 스크리닝 상태');
    } else {
      logger.info(
        mode === 'status' ? await readDailyReportStatus() : await runDailyReport({ dryRun: true }),
        '일일 스크리닝 상태'
      );
    }
  })().catch(() => {
    logger.error('일일 스크리닝 실행 오류. 로컬 설정과 저장 상태를 확인하세요.');
    process.exitCode = 1;
  });
}
