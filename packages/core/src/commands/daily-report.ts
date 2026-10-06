import { constants, type Stats } from 'node:fs';
import { chmod, type FileHandle, lstat, mkdir, open, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pino from 'pino';
import {
  collectFinvizCandidates,
  defaultFinvizCollectionPlan,
  type FinvizCollectorOptions,
  isFinvizBrowserAvailable,
} from '@/reports/finviz-collector';
import {
  createMarketScreenJob,
  getMarketScreenJob,
  type MarketScreenDependencies,
  type MarketScreenJobSnapshot,
  pauseMarketScreenJob,
  runMarketScreenJob,
} from '@/reports/market-screen';
import { writeMarketScreenJson } from '@/reports/market-screen-store';
import type { StockScreenMatch } from '@/reports/stock-screen';
import {
  buildStockReportWhatsAppNotification,
  formatStockReportWhatsAppNotification,
  type StockReportAlertInput,
} from '@/utils/stock-report-alerts';
import { formatScreenTimestamp } from '@/utils/stock-screen-alerts';
import {
  isWhatsAppNotificationConfigured,
  sendWhatsAppNotification,
  type WhatsAppNotification,
  type WhatsAppNotificationResult,
} from '@/utils/whatsapp';

export const DAILY_REPORT_TIMEZONE = 'Australia/Sydney';
const PROJECT_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const EXECUTION_BUDGET_MS = 20 * 60_000;
const TERMINAL = new Set(['completed', 'partial', 'unavailable']);
const logger = pino({ name: 'daily-stock-report' }, process.stderr);

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
  executionBudgetMs?: number;
  pollIntervalMs?: number;
}

interface DailyRunState {
  schemaVersion: 1;
  localDate: string;
  startedAt: string;
  updatedAt: string;
  status: 'running' | 'completed' | 'partial' | 'unavailable' | 'paused' | 'failed' | 'disabled';
  reason: string | null;
  jobId: string | null;
  collectedCount: number;
  sourceTotal: number | null;
  completeness: 'complete' | 'partial' | null;
  analyzedCount: number;
  matchedCount: number;
  notificationStatus: WhatsAppNotificationResult['status'] | null;
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
  return {
    timezone: DAILY_REPORT_TIMEZONE,
    localDate: `${value('year')}-${value('month')}-${value('day')}`,
    startWindow: '09:00–09:14',
    eligible: value('hour') === '09' && Number(value('minute')) < 15,
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

export async function readDailyReportStatus(dependencies: DailyReportDependencies = {}) {
  const schedule = dailyReportSchedule((dependencies.now ?? (() => new Date()))());
  const { root } = directories(dependencies);
  let files: string[];
  try {
    files = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { ...schedule, lastRun: null };
  }
  const latest = files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.state\.json$/.test(file))
    .sort()
    .at(-1);
  if (!latest) return { ...schedule, lastRun: null };
  const state = JSON.parse(await readFile(path.join(root, latest), 'utf8')) as DailyRunState;
  return {
    ...schedule,
    lastRun: {
      localDate: state.localDate,
      status: state.status,
      reason: state.reason,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      jobId: state.jobId,
      collectedCount: state.collectedCount,
      sourceTotal: state.sourceTotal,
      completeness: state.completeness,
      analyzedCount: state.analyzedCount,
      matchedCount: state.matchedCount,
      notificationStatus: state.notificationStatus,
    },
  };
}

export async function runDailyReport(
  options: { dryRun?: boolean } = {},
  dependencies: DailyReportDependencies = {}
) {
  const now = dependencies.now ?? (() => new Date());
  const schedule = dailyReportSchedule(now());
  const environment = dependencies.environment ?? process.env;
  if (options.dryRun) {
    const settings = collectionSettings(environment);
    return {
      ...schedule,
      status: 'dry-run',
      maxCandidates: settings.maxCandidates,
      maxPages: settings.maxPages,
      collectionBudgetMs: settings.timeBudgetMs,
      executionBudgetMs: EXECUTION_BUDGET_MS,
      source: defaultFinvizCollectionPlan(),
      browserReady: await (dependencies.isBrowserAvailable ?? isFinvizBrowserAvailable)(settings),
    };
  }
  if (!schedule.eligible)
    return { status: 'skipped', reason: 'outside-window', localDate: schedule.localDate };
  const { root, market } = directories(dependencies);
  await privateDirectory(root);
  await chmod(root, 0o700);
  const claim = {
    schemaVersion: 1 as const,
    localDate: schedule.localDate,
    startedAt: now().toISOString(),
    timezone: DAILY_REPORT_TIMEZONE,
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
    collectedCount: 0,
    sourceTotal: null,
    completeness: null,
    analyzedCount: 0,
    matchedCount: 0,
    notificationStatus: null,
  };
  const save = async () => {
    state.updatedAt = now().toISOString();
    await writeMarketScreenJson(path.join(root, `${schedule.localDate}.state.json`), state);
  };
  let dispatch: Promise<WhatsAppNotificationResult> | undefined;
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
        const built = typeof notification === 'function' ? await notification() : notification;
        if (state.jobId) {
          try {
            updateCounts(await get());
          } catch {
            /* Keep the last saved checkpoint counts. */
          }
        }
        const coverage =
          state.sourceTotal === null
            ? ''
            : ` · Finviz 후보 ${state.collectedCount}/${state.sourceTotal}${state.completeness === 'partial' ? ' (부분)' : ''}${state.jobId ? ` · 평가 ${state.analyzedCount}/${state.collectedCount}` : ''}`;
        result = await (dependencies.send ?? sendWhatsAppNotification)({
          ...built,
          title: `${built.title.replace(/^시장 후보 스크리닝/, '아침 스크리닝')}${coverage}`,
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
      title: `아침 스크리닝 · ${title}`,
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
    state.analyzedCount = job.progress.analyzed;
    state.matchedCount = job.progress.matched;
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
      const input: StockReportAlertInput = {
        title: `아침 스크리닝 · ${title}`,
        asOf: `${schedule.localDate} Sydney · 검색 중단 ${formatScreenTimestamp(now().toISOString())}`,
        lookbackDays: saved.job.criteria.lookbackDays,
        pipelineConfig: saved.job.criteria.pipelineConfig,
        coverageSummary: '',
        candidates,
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
    const collected = await (dependencies.collect ?? collectFinvizCandidates)(
      collectionSettings(environment)
    );
    state.collectedCount = collected.tickers.length;
    state.sourceTotal = collected.provenance?.sourceTotal ?? null;
    state.completeness = collected.provenance?.completeness ?? null;
    await save();
    if (
      collected.status === 'unavailable' ||
      !collected.provenance ||
      (!collected.tickers.length && state.sourceTotal !== 0)
    ) {
      state.status = 'unavailable';
      state.reason = 'collection-unavailable';
      await fallback(
        '수집 실패',
        'Finviz 후보를 가져오지 못했습니다. 오늘 분석은 시작하지 않았습니다.'
      );
    } else if (collected.tickers.length === 0) {
      state.status = 'completed';
      await fallback('BUY · 후보 없음', '일치 종목 없음.');
    } else {
      let current = await (dependencies.createJob ?? createMarketScreenJob)(
        {
          tickers: collected.tickers,
          provenance: collected.provenance,
          decision: 'BUY',
          lookbackDays: 730,
          autoStart: false,
        },
        jobDependencies
      );
      state.jobId = current.job.id;
      updateCounts(current);
      await save();
      current = await (dependencies.runJob ?? runMarketScreenJob)(state.jobId, jobDependencies);
      updateCounts(current);
      const budget = dependencies.executionBudgetMs ?? EXECUTION_BUDGET_MS;
      const sleep =
        dependencies.sleep ??
        ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
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
            : TERMINAL.has(current.job.status)
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
    const result =
      mode === 'status'
        ? await readDailyReportStatus()
        : await runDailyReport({ dryRun: mode === 'dry-run' });
    logger.info(result, '일일 스크리닝 상태');
  })().catch(() => {
    logger.error('일일 스크리닝 실행 오류. 로컬 설정과 저장 상태를 확인하세요.');
    process.exitCode = 1;
  });
}
