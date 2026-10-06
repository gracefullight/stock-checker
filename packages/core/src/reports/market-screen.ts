import { randomUUID } from 'node:crypto';
import { mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import {
  type MarketScreenPerformanceRegistration,
  registerMarketScreenRecommendation,
} from '@/reports/market-screen-performance';
import {
  acquireMarketScreenLease,
  type MarketScreenLeaseOwner,
  marketScreenOwnerIsAlive,
  readMarketScreenJson,
  readMarketScreenLease,
  writeMarketScreenJson,
} from '@/reports/market-screen-store';
import { projectMatch, type StockScreenMatch } from '@/reports/stock-screen';
import type { analyzeTickerContext } from '@/services/ticker-analysis';
import type { PipelineConfig } from '@/types';
import { loadPipelineConfig } from '@/utils/config-loader';
import { buildStockReportWhatsAppNotification } from '@/utils/stock-report-alerts';
import { formatScreenTimestamp } from '@/utils/stock-screen-alerts';
import { isWhatsAppNotificationConfigured, sendWhatsAppNotification } from '@/utils/whatsapp';

export {
  getMarketScreenPerformance,
  type MarketScreenPerformanceDependencies,
  type MarketScreenPerformancePolicy,
  type MarketScreenPerformanceRow,
  type MarketScreenPerformanceSnapshot,
  type MarketScreenPerformanceStatus,
  type MarketScreenPerformanceSummary,
  refreshMarketScreenPerformance,
} from '@/reports/market-screen-performance';

type Decision = 'BUY' | 'SELL' | 'HOLD' | 'ALL';
type PageKind = 'matches' | 'excluded' | 'unavailable';
type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'partial' | 'unavailable';

export interface FinvizScreenProvenance {
  source: 'Finviz';
  url: string;
  filters: string[];
  sourceTotal: number;
  capturedAt: string;
  completeness: 'complete' | 'partial';
  overallTotal?: number;
  pages?: number;
}

export interface CreateMarketScreenOptions {
  tickers: string[];
  provenance: FinvizScreenProvenance;
  decision?: Decision;
  lookbackDays?: number;
  autoStart?: boolean;
}

export interface MarketScreenDependencies {
  /** Test-only injection; MCP inputs never accept filesystem locations. */
  rootDirectory?: string;
  analyzeTickerContext?: typeof analyzeTickerContext;
  /** Offline configuration injection; public screening inputs do not accept paths. */
  loadPipelineConfig?: typeof loadPipelineConfig;
  minIntervalMs?: number;
  /** Test-only sender injection; public inputs never accept messaging credentials. */
  sendWhatsAppNotification?: typeof sendWhatsAppNotification;
  /** Offline report-builder injection; never exposed as a public MCP input. */
  buildStockReportWhatsAppNotification?: typeof buildStockReportWhatsAppNotification;
  isWhatsAppNotificationConfigured?: typeof isWhatsAppNotificationConfigured;
}

export interface MarketScreenPageOptions {
  kind?: PageKind;
  offset?: number;
  limit?: number;
}

export interface MarketScreenListOptions {
  offset?: number;
  limit?: number;
}

export interface MarketScreenJobList {
  jobs: MarketScreenJob[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface MarketScreenError {
  ticker: string;
  reason: string;
  attempts: number;
}

export interface MarketScreenJob {
  schemaVersion: 1;
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  pauseReason: string | null;
  universe: {
    source: 'finviz-candidates';
    url: string;
    filters: string[];
    sourceTotal: number;
    collectedCount: number;
    inputCount: number;
    capturedAt: string;
    completeness: 'complete' | 'partial';
    overallTotal: number | null;
    pages: number | null;
  };
  criteria: {
    decision: Decision;
    lookbackDays: number;
    engine: string;
    /** Legacy saved jobs may lack a configuration; resumed jobs freeze one before evaluation. */
    pipelineConfig?: PipelineConfig;
    concurrency: 2;
    minIntervalMs: number;
  };
  progress: {
    total: number;
    analyzed: number;
    unavailable: number;
    pending: number;
    inFlight: number;
    matched: number;
    excluded: number;
  };
  warnings: string[];
}

export interface MarketScreenJobSnapshot {
  job: MarketScreenJob;
  page: {
    kind: PageKind;
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
    items: Array<StockScreenMatch | MarketScreenError>;
  };
}

export class MarketScreenJobNotFoundError extends Error {
  constructor() {
    super('Market-screen job was not found.');
    this.name = 'MarketScreenJobNotFoundError';
  }
}

interface Manifest {
  schemaVersion: 1;
  id: string;
  tickers: string[];
}
interface Control {
  desiredStatus: 'running' | 'paused';
  reason: string | null;
}
interface SavedResult {
  index: number;
  kind: PageKind;
  completedAt: string;
  item: StockScreenMatch | MarketScreenError;
  forwardPerformance?: MarketScreenPerformanceRegistration;
}
interface Runtime {
  jobId: string;
  root: string;
  job: MarketScreenJob;
  manifest: Manifest;
  done: Promise<void>;
  writes: Promise<void>;
}
interface NotificationAttempt {
  schemaVersion: 1;
  jobStatus: JobStatus;
  attemptedAt: string;
  finishedAt: string | null;
  result: Awaited<ReturnType<typeof sendWhatsAppNotification>> | null;
}

const DEFAULT_ROOT = fileURLToPath(new URL('../../../../data/market-scans/', import.meta.url));
const JOB_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const FINVIZ_PARAMETERS = new Set(['v', 'f', 'ft', 'o', 'r', 't', 's', 'c', 'ar', 'p', 'ta']);
const activeRuntimes = new Map<string, Runtime>();
const terminal = (status: JobStatus) => ['completed', 'partial', 'unavailable'].includes(status);
const timestamp = () => new Date().toISOString();
const jobFile = (root: string, id: string, name: string) => path.join(root, id, name);

function validId(id: string): string {
  if (typeof id !== 'string' || !JOB_ID_PATTERN.test(id)) {
    throw new TypeError('jobId must be a UUID');
  }
  return id.toLowerCase();
}

async function storeRoot(dependencies: MarketScreenDependencies): Promise<string> {
  const root = dependencies.rootDirectory ?? DEFAULT_ROOT;
  if (!path.isAbsolute(root)) throw new TypeError('Market-screen store must use an absolute path');
  await mkdir(root, { recursive: true, mode: 0o700 });
  return realpath(root);
}

function validateCreate(
  options: CreateMarketScreenOptions,
  dependencies: MarketScreenDependencies
) {
  if (
    !options ||
    !Array.isArray(options.tickers) ||
    options.tickers.length < 1 ||
    options.tickers.length > 15_000
  ) {
    throw new TypeError('tickers must contain from 1 to 15000 symbols');
  }
  const symbols = options.tickers.map((ticker) => {
    if (typeof ticker !== 'string') throw new TypeError('tickers must be valid market symbols');
    const symbol = ticker.trim().toUpperCase();
    if (
      symbol.length < 1 ||
      symbol.length > 32 ||
      !/^\^?[A-Z0-9]+(?:[.-][A-Z0-9]+)*(?:=[A-Z0-9]+)?$/.test(symbol)
    ) {
      throw new TypeError('tickers must be valid market symbols');
    }
    return symbol;
  });
  const tickers = [...new Set(symbols)];
  const provenance = options.provenance;
  if (provenance?.source !== 'Finviz' || !['complete', 'partial'].includes(provenance.completeness))
    throw new TypeError('Valid Finviz provenance is required');
  if (
    !Number.isSafeInteger(provenance.sourceTotal) ||
    provenance.sourceTotal < tickers.length ||
    provenance.sourceTotal < 1
  )
    throw new TypeError('sourceTotal must cover the unique collected symbols');
  if (provenance.completeness === 'complete' && provenance.sourceTotal !== tickers.length)
    throw new TypeError('Complete provenance requires every source candidate to be collected');
  let url: URL;
  try {
    url = new URL(provenance.url);
  } catch {
    throw new TypeError('A valid Finviz screener URL is required');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'finviz.com' ||
    url.port ||
    !['/screener', '/screener.ashx'].includes(url.pathname) ||
    url.username ||
    url.password ||
    url.hash ||
    [...url.searchParams].some(
      ([key, value]) => !FINVIZ_PARAMETERS.has(key) || !/^[A-Za-z0-9_,.+=^-]*$/.test(value)
    ) ||
    [...url.searchParams.keys()].some((key, index, keys) => keys.indexOf(key) !== index)
  )
    throw new TypeError('A public HTTPS Finviz screener URL is required');
  if (
    !Array.isArray(provenance.filters) ||
    provenance.filters.length > 100 ||
    provenance.filters.some(
      (filter) =>
        typeof filter !== 'string' ||
        filter.length > 160 ||
        !/^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(filter)
    )
  )
    throw new TypeError('filters must be a list of public Finviz filter identifiers');
  const sourceFilters = url.searchParams.get('f')?.split(',').filter(Boolean) ?? [];
  if (JSON.stringify(sourceFilters) !== JSON.stringify(provenance.filters)) {
    throw new TypeError('filters must preserve the exact ordered source URL filter identifiers');
  }
  const capturedAt =
    typeof provenance.capturedAt === 'string'
      ? DateTime.fromISO(provenance.capturedAt, { setZone: true })
      : null;
  if (
    typeof provenance.capturedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(provenance.capturedAt) ||
    !capturedAt?.isValid ||
    capturedAt.toMillis() > Date.now()
  )
    throw new TypeError('capturedAt must be a valid past ISO timestamp');
  for (const field of ['overallTotal', 'pages'] as const) {
    const value = provenance[field];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
      throw new TypeError(`${field} must be a positive integer`);
  }
  if (provenance.overallTotal !== undefined && provenance.overallTotal < provenance.sourceTotal)
    throw new TypeError('overallTotal must cover sourceTotal');
  const decision = options.decision === undefined ? 'BUY' : options.decision;
  const lookbackDays = options.lookbackDays === undefined ? 730 : options.lookbackDays;
  if (!['BUY', 'SELL', 'HOLD', 'ALL'].includes(decision))
    throw new TypeError('Invalid decision filter');
  if (!Number.isInteger(lookbackDays) || lookbackDays < 730 || lookbackDays > 3650)
    throw new TypeError('lookbackDays must be an integer from 730 to 3650');
  if (options.autoStart !== undefined && typeof options.autoStart !== 'boolean')
    throw new TypeError('autoStart must be boolean');
  const minIntervalMs = dependencies.minIntervalMs ?? 1_000;
  if (!Number.isInteger(minIntervalMs) || minIntervalMs < 0 || minIntervalMs > 60_000)
    throw new TypeError('Invalid worker pacing');
  return {
    tickers,
    inputCount: symbols.length,
    decision,
    lookbackDays,
    minIntervalMs,
    autoStart: options.autoStart !== false,
    provenance: {
      filters: [...provenance.filters],
      sourceTotal: provenance.sourceTotal,
      completeness: provenance.completeness,
      overallTotal: provenance.overallTotal ?? null,
      pages: provenance.pages ?? null,
    },
    url: url.href,
    capturedAt: capturedAt.toUTC().toISO() as string,
  };
}

async function loadJob(
  root: string,
  id: string
): Promise<{ job: MarketScreenJob; manifest: Manifest }> {
  try {
    const [job, manifest] = await Promise.all([
      readJobState(root, id),
      readMarketScreenJson(jobFile(root, id, 'manifest.json')),
    ]);
    const state = job as MarketScreenJob;
    const saved = manifest as Manifest;
    if (
      state.schemaVersion !== 1 ||
      state.id !== id ||
      saved.schemaVersion !== 1 ||
      saved.id !== id ||
      !Array.isArray(saved.tickers) ||
      saved.tickers.length !== state.progress.total
    )
      throw new Error('Invalid saved job');
    return { job: state, manifest: saved };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new MarketScreenJobNotFoundError();
    throw new Error('Saved market-screen job could not be read.');
  }
}

async function readJobState(root: string, id: string): Promise<MarketScreenJob> {
  const saved = (await readMarketScreenJson(jobFile(root, id, 'state.json'))) as MarketScreenJob;
  if (
    saved?.schemaVersion !== 1 ||
    saved.id !== id ||
    typeof saved.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(saved.createdAt)) ||
    !Number.isInteger(saved.progress?.total) ||
    saved.progress.total < 1 ||
    saved.progress.total > 15_000
  )
    throw new Error('Invalid saved job');
  return saved;
}

async function readControl(root: string, id: string): Promise<Control> {
  const value = (await readMarketScreenJson(jobFile(root, id, 'control.json'))) as Control;
  if (!['running', 'paused'].includes(value.desiredStatus))
    throw new Error('Invalid saved control');
  return value;
}

async function results(root: string, id: string, kind: PageKind): Promise<SavedResult[]> {
  const directory = jobFile(root, id, `results/${kind}`);
  const entries = (await readdir(directory)).filter((entry) => /^\d{8}\.json$/.test(entry));
  const rows: SavedResult[] = [];
  // File reads are independent of the two network-worker slots.
  for (let index = 0; index < entries.length; index += 20) {
    const batch = await Promise.all(
      entries
        .slice(index, index + 20)
        .map(
          async (entry) => readMarketScreenJson(path.join(directory, entry)) as Promise<SavedResult>
        )
    );
    for (const row of batch) {
      if (
        !Number.isInteger(row.index) ||
        row.kind !== kind ||
        !row.item ||
        typeof row.item.ticker !== 'string'
      )
        throw new Error('Invalid saved result');
      rows.push(row);
    }
  }
  return rows;
}

async function refreshJobSummary(
  root: string,
  id: string,
  job: MarketScreenJob,
  sharedLease?: MarketScreenLeaseOwner | null
): Promise<MarketScreenJob> {
  const control = await readControl(root, id);
  const savedCounts = await Promise.all(
    (['matches', 'excluded', 'unavailable'] as const).map(
      async (resultKind) =>
        (await readdir(jobFile(root, id, `results/${resultKind}`))).filter((name) =>
          /^\d{8}\.json$/.test(name)
        ).length
    )
  );
  job.progress.matched = savedCounts[0];
  job.progress.excluded = savedCounts[1];
  job.progress.analyzed = savedCounts[0] + savedCounts[1];
  job.progress.unavailable = savedCounts[2];
  job.progress.inFlight = Math.min(
    job.progress.inFlight,
    Math.max(0, job.progress.total - savedCounts.reduce((sum, count) => sum + count, 0))
  );
  job.progress.pending =
    job.progress.total - job.progress.analyzed - job.progress.unavailable - job.progress.inFlight;
  if (!terminal(job.status)) {
    const lease = sharedLease === undefined ? await readMarketScreenLease(root) : sharedLease;
    const isActive =
      lease?.jobId === id &&
      lease.purpose !== 'forward-paper-performance' &&
      marketScreenOwnerIsAlive(lease);
    if (control.desiredStatus === 'paused') {
      job.status = 'paused';
      job.pauseReason = control.reason;
    } else if (!isActive) {
      job.status = 'paused';
      job.pauseReason = 'No worker is active; resume to continue pending candidates.';
    } else {
      job.status = 'running';
      job.pauseReason = null;
    }
    if (!isActive) {
      job.progress.pending += job.progress.inFlight;
      job.progress.inFlight = 0;
    }
  }
  return job;
}

async function snapshot(
  root: string,
  id: string,
  options: MarketScreenPageOptions = {}
): Promise<MarketScreenJobSnapshot> {
  const kind = options.kind ?? 'matches';
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20;
  if (
    !['matches', 'excluded', 'unavailable'].includes(kind) ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new TypeError('Invalid result pagination');
  const { job: saved } = await loadJob(root, id);
  const job = await refreshJobSummary(root, id, saved);
  const rows = await results(root, id, kind);
  if (kind === 'unavailable') rows.sort((left, right) => left.index - right.index);
  else {
    const metric = job.criteria.decision === 'SELL' ? 'sellScore' : 'buyScore';
    rows.sort(
      (left, right) =>
        (right.item as StockScreenMatch)[metric] - (left.item as StockScreenMatch)[metric] ||
        left.item.ticker.localeCompare(right.item.ticker)
    );
  }
  return {
    job,
    page: {
      kind,
      offset,
      limit,
      total: rows.length,
      hasMore: offset + limit < rows.length,
      items: rows.slice(offset, offset + limit).map((row) => row.item),
    },
  };
}

async function checkpoint(runtime: Runtime): Promise<void> {
  runtime.job.updatedAt = timestamp();
  const saved = structuredClone(runtime.job);
  runtime.writes = runtime.writes.then(() =>
    writeMarketScreenJson(jobFile(runtime.root, runtime.jobId, 'state.json'), saved)
  );
  await runtime.writes;
}

async function notifyCompletion(
  runtime: Runtime,
  dependencies: MarketScreenDependencies
): Promise<void> {
  if (!terminal(runtime.job.status)) return;
  try {
    const file = jobFile(runtime.root, runtime.jobId, 'notification.json');
    try {
      await readMarketScreenJson(file);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
    }
    const rows = await results(runtime.root, runtime.jobId, 'matches');
    const metric = runtime.job.criteria.decision === 'SELL' ? 'sellScore' : 'buyScore';
    rows.sort(
      (left, right) =>
        (right.item as StockScreenMatch)[metric] - (left.item as StockScreenMatch)[metric] ||
        left.item.ticker.localeCompare(right.item.ticker)
    );
    const candidates = rows.slice(0, 3).map(({ item }) => {
      const match = item as StockScreenMatch;
      return {
        ticker: match.ticker,
        decision: match.decision,
        dataAsOf: match.dataAsOf,
        gateReasons: match.gateReasons,
        reference: match.execution.reference,
      };
    });
    const { progress, universe } = runtime.job;
    const coverageSummary = [
      `필터 ${runtime.job.criteria.decision} · 분석 ${progress.analyzed}/${progress.total} · 일치 ${progress.matched} · 제외 ${progress.excluded} · 자료 없음 ${progress.unavailable} · 알림 ${candidates.length}/${progress.matched}개`,
      `Finviz 후보 수집 ${universe.collectedCount}/${universe.sourceTotal} · ${universe.completeness === 'complete' ? '완전 수집' : '부분 수집'}`,
    ].join('\n');
    const attempt: NotificationAttempt = {
      schemaVersion: 1,
      jobStatus: runtime.job.status,
      attemptedAt: timestamp(),
      finishedAt: null,
      result: null,
    };
    // The job lease remains held. A durable attempt precedes every outbound call;
    // crashes, failures and disabled senders never trigger automatic retries.
    await writeMarketScreenJson(file, attempt);
    let result: NonNullable<NotificationAttempt['result']>;
    try {
      const input = {
        title: `시장 후보 스크리닝 · ${runtime.job.criteria.decision} · ${runtime.job.status === 'completed' ? '완료' : runtime.job.status === 'partial' ? '일부 누락' : '자료 없음'}`,
        asOf: `검색 완료 ${formatScreenTimestamp(runtime.job.finishedAt ?? runtime.job.updatedAt)}`,
        coverageSummary,
        lookbackDays: runtime.job.criteria.lookbackDays,
        candidates,
      };
      const configured = await (
        dependencies.isWhatsAppNotificationConfigured ?? isWhatsAppNotificationConfigured
      )();
      const notification = configured
        ? await (
            dependencies.buildStockReportWhatsAppNotification ??
            buildStockReportWhatsAppNotification
          )(input)
        : {
            title: input.title,
            asOf: input.asOf,
            summary: [
              ...(rows.length
                ? [
                    ...rows.slice(0, 3).map(({ item }) => {
                      const match = item as StockScreenMatch;
                      return `${match.ticker} ${match.decision} · 참고 ${match.execution.reference?.price.toFixed(2) ?? '자료 없음'} · ${metric === 'sellScore' ? 'SELL' : 'BUY'} 점수 ${match[metric].toFixed(1)} · 종가일 ${match.dataAsOf ?? '자료 없음'}`;
                    }),
                  ]
                : ['일치 종목 없음.']),
            ]
              .join('\n')
              .slice(0, 700),
          };
      result = await (dependencies.sendWhatsAppNotification ?? sendWhatsAppNotification)(
        notification
      );
    } catch {
      result = { status: 'failed', reason: 'network-error' };
    }
    await writeMarketScreenJson(file, { ...attempt, finishedAt: timestamp(), result });
  } catch {
    // Messaging and its private artifact cannot invalidate a saved terminal job.
  }
}

function rateLimited(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    name?: unknown;
    message?: unknown;
  };
  return (
    value.status === 429 ||
    value.statusCode === 429 ||
    value.response?.status === 429 ||
    value.name === 'RateLimitError' ||
    (typeof value.message === 'string' &&
      /\b429\b|too many requests|rate.limit/i.test(value.message))
  );
}

async function defaultAnalyzer(...args: Parameters<typeof analyzeTickerContext>) {
  const engine = await import('@/services/ticker-analysis');
  return engine.analyzeTickerContext(...args);
}

async function execute(
  runtime: Runtime,
  dependencies: MarketScreenDependencies,
  release: () => Promise<void>
) {
  const analyze = dependencies.analyzeTickerContext ?? defaultAnalyzer;
  try {
    if (!runtime.job.criteria.pipelineConfig) {
      runtime.job.criteria.pipelineConfig = await (
        dependencies.loadPipelineConfig ?? loadPipelineConfig
      )();
      runtime.job.warnings.push(
        'This legacy job had no saved configuration. Remaining candidates use the configuration frozen at resume; earlier results may use different settings.'
      );
    }
    const pipelineConfig = runtime.job.criteria.pipelineConfig;
    const previous = (
      await Promise.all(
        (['matches', 'excluded', 'unavailable'] as const).map((kind) =>
          results(runtime.root, runtime.jobId, kind)
        )
      )
    ).flat();
    if (
      previous.some(
        (row) =>
          row.index < 0 ||
          row.index >= runtime.manifest.tickers.length ||
          row.item.ticker !== runtime.manifest.tickers[row.index]
      ) ||
      new Set(previous.map((row) => row.index)).size !== previous.length
    ) {
      throw new Error('Persisted results do not match the frozen manifest');
    }
    const done = new Set(previous.map((row) => row.index));
    runtime.job.progress = {
      total: runtime.manifest.tickers.length,
      analyzed: previous.filter((row) => row.kind !== 'unavailable').length,
      unavailable: previous.filter((row) => row.kind === 'unavailable').length,
      matched: previous.filter((row) => row.kind === 'matches').length,
      excluded: previous.filter((row) => row.kind === 'excluded').length,
      pending: runtime.manifest.tickers.length - done.size,
      inFlight: 0,
    };
    const pending = runtime.manifest.tickers
      .map((_ticker, index) => index)
      .filter((index) => !done.has(index));
    let cursor = 0;
    let fatalStop = false;
    let consecutiveUnavailable = 0;
    await checkpoint(runtime);
    const outcomes = await Promise.allSettled(
      Array.from({ length: Math.min(2, pending.length) }, async () => {
        try {
          let lastStartedAt = 0;
          while (cursor < pending.length) {
            if (fatalStop) return;
            if ((await readControl(runtime.root, runtime.jobId)).desiredStatus !== 'running')
              return;
            const delay = Math.max(
              0,
              runtime.job.criteria.minIntervalMs - (Date.now() - lastStartedAt)
            );
            if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
            if (fatalStop) return;
            if ((await readControl(runtime.root, runtime.jobId)).desiredStatus !== 'running')
              return;
            if (cursor >= pending.length) return;
            const index = pending[cursor++];
            const ticker = runtime.manifest.tickers[index];
            runtime.job.progress.pending--;
            runtime.job.progress.inFlight++;
            await checkpoint(runtime);
            lastStartedAt = Date.now();
            let saved: SavedResult;
            try {
              const context = await analyze(ticker, null, {
                lookbackDays: runtime.job.criteria.lookbackDays,
                pipelineConfig,
              });
              if (!context) throw new Error('No usable completed-session analysis is available.');
              const match = projectMatch(ticker, context);
              saved = {
                index,
                kind:
                  runtime.job.criteria.decision === 'ALL' ||
                  match.decision === runtime.job.criteria.decision
                    ? 'matches'
                    : 'excluded',
                completedAt: timestamp(),
                item: match,
              };
              if (saved.kind === 'matches' && match.decision === 'BUY') {
                saved.forwardPerformance = registerMarketScreenRecommendation(
                  match.dataAsOf,
                  saved.completedAt
                );
              }
            } catch (error) {
              if (rateLimited(error)) {
                fatalStop = true;
                await writeMarketScreenJson(jobFile(runtime.root, runtime.jobId, 'control.json'), {
                  desiredStatus: 'paused',
                  reason:
                    'The market data provider is rate-limiting requests; the job was paused without automatic retries.',
                } satisfies Control);
              }
              saved = {
                index,
                kind: 'unavailable',
                completedAt: timestamp(),
                item: {
                  ticker,
                  reason: rateLimited(error)
                    ? 'The market data provider rate-limited this analysis.'
                    : 'No usable completed-session analysis could be produced.',
                  attempts: 1,
                },
              };
            }
            consecutiveUnavailable = saved.kind === 'unavailable' ? consecutiveUnavailable + 1 : 0;
            if (consecutiveUnavailable >= 5 && !fatalStop) {
              fatalStop = true;
              await writeMarketScreenJson(jobFile(runtime.root, runtime.jobId, 'control.json'), {
                desiredStatus: 'paused',
                reason:
                  'Consecutive unavailable analyses; provider access or data availability may be impaired. Resume to evaluate remaining candidates without retrying completed failures.',
              } satisfies Control);
            }
            await writeMarketScreenJson(
              jobFile(
                runtime.root,
                runtime.jobId,
                `results/${saved.kind}/${String(index).padStart(8, '0')}.json`
              ),
              saved
            );
            runtime.job.progress.inFlight--;
            if (saved.kind === 'unavailable') runtime.job.progress.unavailable++;
            else {
              runtime.job.progress.analyzed++;
              if (saved.kind === 'matches') runtime.job.progress.matched++;
              else runtime.job.progress.excluded++;
            }
            await checkpoint(runtime);
          }
        } catch (error) {
          fatalStop = true;
          throw error;
        }
      })
    );
    if (outcomes.some((outcome) => outcome.status === 'rejected')) {
      throw new Error('A worker checkpoint failed');
    }
    const control = await readControl(runtime.root, runtime.jobId);
    if (runtime.job.progress.pending === 0) {
      runtime.job.status =
        runtime.job.progress.analyzed === 0
          ? 'unavailable'
          : runtime.job.progress.unavailable > 0 || runtime.job.universe.completeness === 'partial'
            ? 'partial'
            : 'completed';
      runtime.job.finishedAt = timestamp();
      runtime.job.pauseReason = null;
    } else {
      runtime.job.status = 'paused';
      runtime.job.pauseReason =
        control.reason ?? 'The scan is paused; resume to evaluate remaining candidates.';
    }
    await checkpoint(runtime);
    await notifyCompletion(runtime, dependencies);
  } catch {
    runtime.job.status = 'paused';
    runtime.job.pauseReason =
      'The job stopped because a checkpoint could not be read or saved; resume to recover persisted results.';
    try {
      await writeMarketScreenJson(jobFile(runtime.root, runtime.jobId, 'control.json'), {
        desiredStatus: 'paused',
        reason: runtime.job.pauseReason,
      } satisfies Control);
      runtime.writes = Promise.resolve();
      await checkpoint(runtime);
    } catch {
      /* Persisted per-ticker results remain recoverable. */
    }
  } finally {
    await release();
    if (activeRuntimes.get(runtime.root) === runtime) activeRuntimes.delete(runtime.root);
    if (
      !terminal(runtime.job.status) &&
      runtime.job.progress.pending > 0 &&
      (await readControl(runtime.root, runtime.jobId)).desiredStatus === 'running'
    ) {
      void runMarketScreenJob(runtime.jobId, dependencies).catch(() => {});
    }
  }
}

export async function createMarketScreenJob(
  options: CreateMarketScreenOptions,
  dependencies: MarketScreenDependencies = {}
): Promise<MarketScreenJobSnapshot> {
  const input = validateCreate(options, dependencies);
  const pipelineConfig = await (dependencies.loadPipelineConfig ?? loadPipelineConfig)();
  const root = await storeRoot(dependencies);
  const id = randomUUID();
  const now = timestamp();
  const job: MarketScreenJob = {
    schemaVersion: 1,
    id,
    status: 'paused',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    pauseReason: 'Job was created paused.',
    universe: {
      source: 'finviz-candidates',
      url: input.url,
      filters: input.provenance.filters,
      sourceTotal: input.provenance.sourceTotal,
      collectedCount: input.tickers.length,
      inputCount: input.inputCount,
      capturedAt: input.capturedAt,
      completeness: input.provenance.completeness,
      overallTotal: input.provenance.overallTotal,
      pages: input.provenance.pages,
    },
    criteria: {
      decision: input.decision,
      lookbackDays: input.lookbackDays,
      engine: 'Shared leader-pullback pipeline with a persisted configuration per job',
      pipelineConfig,
      concurrency: 2,
      minIntervalMs: input.minIntervalMs,
    },
    progress: {
      total: input.tickers.length,
      analyzed: 0,
      unavailable: 0,
      pending: input.tickers.length,
      inFlight: 0,
      matched: 0,
      excluded: 0,
    },
    warnings: [
      'Finviz filters select candidates; they do not determine the engine final BUY, SELL, or HOLD decision.',
      'This job covers only the frozen collected Finviz candidate list, not every US-listed stock or every filtered source candidate when collection is partial.',
      'Scores are signal strengths, not success probabilities. Repeated snapshots from the same completed session are not independent new opportunities.',
      'Future next-session entry prices are unknown; ATR references use completed closes. SELL is a long-holder exit warning, not a short-entry recommendation.',
      'Analysis timestamps and completed-session dates can differ during a long scan. Current metadata is not a frozen point-in-time financial dataset.',
      'Provider failures are unavailable results, never HOLD. Historical outcome rates and analyst targets require analyze_stock.',
      ...(input.provenance.completeness === 'partial'
        ? [
            `Only ${input.tickers.length} of ${input.provenance.sourceTotal} declared Finviz candidates were collected; missing candidates were not evaluated.`,
          ]
        : []),
    ],
  };
  await mkdir(jobFile(root, id, ''), { mode: 0o700 });
  for (const kind of ['matches', 'excluded', 'unavailable'])
    await mkdir(jobFile(root, id, `results/${kind}`), { recursive: true, mode: 0o700 });
  await writeMarketScreenJson(jobFile(root, id, 'manifest.json'), {
    schemaVersion: 1,
    id,
    tickers: input.tickers,
  } satisfies Manifest);
  await writeMarketScreenJson(jobFile(root, id, 'state.json'), job);
  await writeMarketScreenJson(jobFile(root, id, 'control.json'), {
    desiredStatus: 'paused',
    reason: job.pauseReason,
  } satisfies Control);
  return input.autoStart ? runMarketScreenJob(id, dependencies) : snapshot(root, id);
}

export async function getMarketScreenJob(
  id: string,
  options: MarketScreenPageOptions = {},
  dependencies: MarketScreenDependencies = {}
): Promise<MarketScreenJobSnapshot> {
  const jobId = validId(id);
  return snapshot(await storeRoot(dependencies), jobId, options);
}

/**
 * Read-only, best-effort directory listing. Missing/deleted artifacts are omitted;
 * corrupt or inaccessible saved jobs fail the request instead of disappearing.
 * Result contents are never read, and result-directory counts are refreshed only
 * for the selected page. Totals can change when another process creates/deletes jobs.
 */
export async function listMarketScreenJobs(
  options: MarketScreenListOptions = {},
  dependencies: MarketScreenDependencies = {}
): Promise<MarketScreenJobList> {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new TypeError('Invalid job pagination');
  const directory = dependencies.rootDirectory ?? DEFAULT_ROOT;
  if (!path.isAbsolute(directory))
    throw new TypeError('Market-screen store must use an absolute path');
  const empty: MarketScreenJobList = { jobs: [], offset, limit, total: 0, hasMore: false };
  let root: string;
  try {
    root = await realpath(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty;
    throw new Error('Saved market-screen jobs could not be listed.');
  }
  const headers: MarketScreenJob[] = [];
  try {
    const entries = (await readdir(root, { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && JOB_ID_PATTERN.test(entry.name)
    );
    for (let index = 0; index < entries.length; index += 20) {
      const batch = await Promise.all(
        entries.slice(index, index + 20).map(async (entry) => {
          try {
            return await readJobState(root, entry.name);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
          }
        })
      );
      for (const job of batch) if (job) headers.push(job);
    }
    headers.sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id)
    );
    const jobs: MarketScreenJob[] = [];
    let cursor = offset;
    let sharedLease: MarketScreenLeaseOwner | null | undefined;
    while (jobs.length < limit && cursor < headers.length) {
      const header = headers[cursor];
      try {
        const { job } = await loadJob(root, header.id);
        if (!terminal(job.status) && sharedLease === undefined)
          sharedLease = await readMarketScreenLease(root);
        jobs.push(await refreshJobSummary(root, header.id, job, sharedLease));
        cursor++;
      } catch (error) {
        if (
          error instanceof MarketScreenJobNotFoundError ||
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          headers.splice(cursor, 1);
          continue;
        }
        throw error;
      }
    }
    return { jobs, offset, limit, total: headers.length, hasMore: cursor < headers.length };
  } catch {
    throw new Error('Saved market-screen jobs could not be listed.');
  }
}

export async function runMarketScreenJob(
  id: string,
  dependencies: MarketScreenDependencies = {}
): Promise<MarketScreenJobSnapshot> {
  const jobId = validId(id);
  const root = await storeRoot(dependencies);
  const { job, manifest } = await loadJob(root, jobId);
  if (terminal(job.status)) return snapshot(root, jobId);
  const active = activeRuntimes.get(root);
  if (active && active.jobId === jobId) {
    await writeMarketScreenJson(jobFile(root, jobId, 'control.json'), {
      desiredStatus: 'running',
      reason: null,
    } satisfies Control);
    return snapshot(root, jobId);
  }
  const lease = await acquireMarketScreenLease(root, jobId);
  if (!lease.acquired) {
    const sameJob =
      lease.owner.jobId === jobId && lease.owner.purpose !== 'forward-paper-performance';
    await writeMarketScreenJson(jobFile(root, jobId, 'control.json'), {
      desiredStatus: sameJob ? 'running' : 'paused',
      reason: sameJob
        ? null
        : lease.owner.purpose === 'forward-paper-performance'
          ? 'A paper performance refresh is active; resume after its worker finishes.'
          : 'Another market-screen job is active; resume after its workers finish.',
    } satisfies Control);
    return snapshot(root, jobId);
  }
  try {
    await writeMarketScreenJson(jobFile(root, jobId, 'control.json'), {
      desiredStatus: 'running',
      reason: null,
    } satisfies Control);
    job.status = 'running';
    job.startedAt ??= timestamp();
    job.updatedAt = timestamp();
    job.pauseReason = null;
    await writeMarketScreenJson(jobFile(root, jobId, 'state.json'), job);
  } catch (error) {
    await lease.release();
    throw error;
  }
  const runtime: Runtime = {
    jobId,
    root,
    job,
    manifest,
    done: Promise.resolve(),
    writes: Promise.resolve(),
  };
  activeRuntimes.set(root, runtime);
  runtime.done = execute(runtime, dependencies, lease.release);
  void runtime.done.catch(() => {});
  return snapshot(root, jobId);
}

export async function pauseMarketScreenJob(
  id: string,
  dependencies: MarketScreenDependencies = {}
): Promise<MarketScreenJobSnapshot> {
  const jobId = validId(id);
  const root = await storeRoot(dependencies);
  const { job } = await loadJob(root, jobId);
  if (!terminal(job.status)) {
    await writeMarketScreenJson(jobFile(root, jobId, 'control.json'), {
      desiredStatus: 'paused',
      reason: 'Job was paused; in-progress analyses retain their worker slots until they finish.',
    } satisfies Control);
  }
  return snapshot(root, jobId);
}
