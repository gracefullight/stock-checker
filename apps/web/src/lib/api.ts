import type {
  MarketScreenError,
  MarketScreenJob,
  MarketScreenJobSnapshot,
  MarketScreenPerformanceRow,
  MarketScreenPerformanceSnapshot,
} from '@stock-checker/core/src/reports/market-screen.ts';
import type { StockScreenMatch } from '@stock-checker/core/src/reports/stock-screen.ts';
import type { TickerResult } from '@stock-checker/core/src/types';
import axios, { type AxiosError } from 'axios';

// Server components can use the non-public env var to avoid exposing internal
// addresses. Clients only see NEXT_PUBLIC_* so the fallback chain is:
//   process.env.API_URL (server-only)  →  process.env.NEXT_PUBLIC_API_URL  →  localhost
const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5101';

export type {
  MarketScreenJob,
  MarketScreenJobSnapshot,
  MarketScreenPerformanceRow,
  MarketScreenPerformanceSnapshot,
  TickerResult,
};

export interface FearGreedResult {
  value: number;
  label: string;
  timestamp: Date;
}

// DTO shapes mirror the core service interfaces, with Date fields serialized
// to ISO strings by Fastify's JSON encoder.
export interface FundamentalsDTO {
  ticker: string;
  pe: number | null;
  dividendYield: number | null;
  nextEarningsDate: string | null;
  exDividendDate: string | null;
  dividendDate: string | null;
  marketCap: number | null;
  sector: string | null;
}

export interface EarningsHistoryRowDTO {
  reportDate: string;
  dateBasis?: 'reported' | 'fiscal-quarter';
  epsActual: number | null;
  epsEstimate: number | null;
  epsDifference: number | null;
  surprisePercent: number | null;
}

export interface EstimateRevisionsDTO {
  up30: number | null;
  down30: number | null;
  current: number | null;
  thirtyDaysAgo: number | null;
  direction: 'up' | 'down' | 'flat' | null;
}

export interface EarningsDTO {
  ticker: string;
  nextEarningsDate: string | null;
  nextEarningsEstimate: {
    avg: number | null;
    low: number | null;
    high: number | null;
    yearAgoEps: number | null;
    numberOfAnalysts: number | null;
  } | null;
  earningsHistory: EarningsHistoryRowDTO[];
  estimateRevisions: EstimateRevisionsDTO | null;
}

export interface NewsItemDTO {
  title: string;
  url: string;
  publishedAt: string;
  summary: string;
}

export interface DividendsDTO {
  ticker: string;
  dividendYield: number | null;
  payoutRatio: number | null;
  annualDividendRate: number | null;
  lastDividendDate: string | null;
  nextDividendDate: string | null;
  dividendHistory: Array<{ date: string; amount: number }>;
}

export interface TickerDetailResult extends TickerResult {
  fundamentals?: FundamentalsDTO;
  news?: NewsItemDTO[];
  earnings?: EarningsDTO;
  dividends?: DividendsDTO;
}

export interface OHLCVCandle {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  gaussianMid: number;
  gaussianUpper: number;
  gaussianLower: number;
  gaussianGreen: boolean;
  signal: 'BUY' | 'SELL' | 'HOLD' | null;
}

const instance = axios.create({
  baseURL: API_URL,
  // Upstream (yahoo-finance: fundamentals + earnings + OHLCV) routinely needs
  // well over 10s; keep a generous ceiling so detail/portfolio pages don't
  // false-timeout while still bounding genuinely hung requests.
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

instance.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response) {
      const { status, statusText } = error.response;
      throw new Error(`API error ${status}: ${statusText}`);
    }
    // Network error, timeout, or request setup failure
    throw new Error(`API error: ${error.message}`);
  }
);

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await instance.request<T>({
    url: path,
    method: init?.method as string | undefined,
    headers: init?.headers as Record<string, string> | undefined,
    data: init?.body,
    signal: init?.signal ?? undefined,
  });
  return response.data;
}

/**
 * GET /api/screener?tickers=AAPL,TSLA,NVDA
 */
export async function getScreener(tickers: string[]): Promise<TickerResult[]> {
  const params = new URLSearchParams({ tickers: tickers.join(',') });
  const res = await apiFetch<{ results: TickerResult[] }>(`/api/screener?${params.toString()}`);
  return res.results;
}

/**
 * GET /api/screener/:ticker?include=fundamentals,news,earnings
 */
export function getTickerDetail(
  ticker: string,
  include: string[] = ['fundamentals', 'earnings']
): Promise<TickerDetailResult> {
  const params = new URLSearchParams({ include: include.join(',') });
  return apiFetch<TickerDetailResult>(
    `/api/screener/${encodeURIComponent(ticker)}?${params.toString()}`
  );
}

/**
 * GET /api/market/fear-greed
 */
export function getFearGreed(): Promise<FearGreedResult> {
  return apiFetch<FearGreedResult>('/api/market/fear-greed');
}

export interface FxRateResult {
  currency: string;
  /** Units of `currency` per 1 USD. */
  rate: number;
  prevClose: number | null;
  dayChangePct: number | null;
  asOf: string;
}

/**
 * GET /api/market/fx?currency=KRW
 */
export function getFxRate(currency: string): Promise<FxRateResult> {
  const params = new URLSearchParams({ currency });
  return apiFetch<FxRateResult>(`/api/market/fx?${params.toString()}`);
}

/**
 * GET /api/portfolio
 */
export async function getPortfolio(): Promise<string[]> {
  const res = await apiFetch<{ assets: string[]; createdAt: string }>('/api/portfolio');
  return res.assets;
}

/**
 * POST /api/portfolio/:ticker
 */
export function addToPortfolio(ticker: string): Promise<void> {
  return apiFetch<void>(`/api/portfolio/${encodeURIComponent(ticker)}`, { method: 'POST' });
}

/**
 * DELETE /api/portfolio/:ticker
 */
export function removeFromPortfolio(ticker: string): Promise<void> {
  return apiFetch<void>(`/api/portfolio/${encodeURIComponent(ticker)}`, { method: 'DELETE' });
}

/**
 * GET /api/watchlist
 */
export async function getWatchlist(): Promise<string[]> {
  const res = await apiFetch<{ tickers: string[]; createdAt: string }>('/api/watchlist');
  return res.tickers;
}

/**
 * POST /api/watchlist/:ticker
 */
export function addToWatchlist(ticker: string): Promise<void> {
  return apiFetch<void>(`/api/watchlist/${encodeURIComponent(ticker)}`, { method: 'POST' });
}

/**
 * DELETE /api/watchlist/:ticker
 */
export function removeFromWatchlist(ticker: string): Promise<void> {
  return apiFetch<void>(`/api/watchlist/${encodeURIComponent(ticker)}`, { method: 'DELETE' });
}

export interface BacktestDataResponse {
  ticker: string;
  candles: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  spy: Array<{ date: string; close: number; volume: number; high: number; low: number }>;
  sector: {
    etf: string;
    candles: Array<{ date: string; close: number; volume: number; high: number; low: number }>;
  } | null;
}

/**
 * GET /api/screener/:ticker/backtest-data?days=1825
 */
export function getBacktestData(ticker: string, days = 1825): Promise<BacktestDataResponse> {
  return apiFetch<BacktestDataResponse>(
    `/api/screener/${encodeURIComponent(ticker)}/backtest-data?days=${days}`
  );
}

/**
 * GET /api/screener/:ticker/ohlcv?days=180
 */
export function getOHLCV(ticker: string, days = 180): Promise<OHLCVCandle[]> {
  return apiFetch<OHLCVCandle[]>(`/api/screener/${encodeURIComponent(ticker)}/ohlcv?days=${days}`);
}

export interface MarketScreenJobsResponse {
  jobs: MarketScreenJob[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export type MarketScreenResultKind = MarketScreenJobSnapshot['page']['kind'];

const marketScreenStatuses = new Set([
  'queued',
  'running',
  'paused',
  'completed',
  'partial',
  'unavailable',
]);
const marketScreenDecisions = new Set(['BUY', 'SELL', 'HOLD', 'ALL']);
const marketScreenKinds = new Set(['matches', 'excluded', 'unavailable']);
const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

function validMarketScreenJob(value: unknown): value is MarketScreenJob {
  if (!record(value)) return false;
  const job = value as unknown as MarketScreenJob;
  const progress = job.progress;
  const universe = job.universe;
  return (
    job.schemaVersion === 1 &&
    typeof job.id === 'string' &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(job.id) &&
    marketScreenStatuses.has(job.status) &&
    typeof job.updatedAt === 'string' &&
    Number.isFinite(Date.parse(job.updatedAt)) &&
    (job.pauseReason === null || typeof job.pauseReason === 'string') &&
    record(progress) &&
    Object.values(progress).every(nonnegativeInteger) &&
    progress.total > 0 &&
    progress.inFlight <= 2 &&
    progress.analyzed === progress.matched + progress.excluded &&
    progress.analyzed + progress.unavailable + progress.pending + progress.inFlight ===
      progress.total &&
    record(universe) &&
    universe.source === 'finviz-candidates' &&
    typeof universe.url === 'string' &&
    strings(universe.filters) &&
    nonnegativeInteger(universe.sourceTotal) &&
    universe.sourceTotal >= progress.total &&
    universe.collectedCount === progress.total &&
    ['complete', 'partial'].includes(universe.completeness) &&
    (universe.completeness !== 'complete' || universe.sourceTotal === universe.collectedCount) &&
    typeof universe.capturedAt === 'string' &&
    record(job.criteria) &&
    marketScreenDecisions.has(job.criteria.decision) &&
    Number.isInteger(job.criteria.lookbackDays) &&
    job.criteria.lookbackDays >= 730 &&
    job.criteria.lookbackDays <= 3650 &&
    strings(job.warnings)
  );
}

function validMarketScreenItem(value: unknown, kind: MarketScreenResultKind): boolean {
  if (!record(value) || typeof value.ticker !== 'string') return false;
  if (kind === 'unavailable') {
    const error = value as unknown as MarketScreenError;
    return typeof error.reason === 'string' && nonnegativeInteger(error.attempts);
  }
  const item = value as unknown as StockScreenMatch;
  const reference = item.execution?.reference;
  return (
    ['BUY', 'SELL', 'HOLD'].includes(item.decision) &&
    [item.score, item.buyScore, item.sellScore].every(Number.isFinite) &&
    (item.dataAsOf === null ||
      (typeof item.dataAsOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dataAsOf))) &&
    strings(item.gateReasons) &&
    record(item.execution) &&
    record(item.execution.entry) &&
    item.execution.entry.price === null &&
    typeof item.execution.entry.eligible === 'boolean' &&
    (reference === null ||
      (record(reference) &&
        [
          reference.price,
          reference.atr,
          reference.stopLoss,
          reference.takeProfit,
          reference.trailingStop,
          reference.trailingStart,
        ].every((number) => Number.isFinite(number) && number > 0)))
  );
}

function checkedMarketScreenSnapshot(
  value: unknown,
  jobId: string,
  kind?: MarketScreenResultKind
): MarketScreenJobSnapshot {
  if (!record(value)) throw new Error('Invalid market-screen response; retry to refresh.');
  const snapshot = value as unknown as MarketScreenJobSnapshot;
  const page = snapshot.page;
  if (
    !validMarketScreenJob(snapshot.job) ||
    snapshot.job.id !== jobId ||
    !record(page) ||
    !marketScreenKinds.has(page.kind) ||
    (kind && page.kind !== kind) ||
    !nonnegativeInteger(page.offset) ||
    !nonnegativeInteger(page.total) ||
    !Number.isInteger(page.limit) ||
    page.limit < 1 ||
    page.limit > 100 ||
    typeof page.hasMore !== 'boolean' ||
    !Array.isArray(page.items) ||
    page.items.length > page.limit ||
    !page.items.every((item) => validMarketScreenItem(item, page.kind))
  )
    throw new Error('Invalid market-screen response; retry to refresh.');
  return snapshot;
}

export async function getMarketScreens(
  options: { offset?: number; limit?: number; signal?: AbortSignal } = {}
): Promise<MarketScreenJobsResponse> {
  const params = new URLSearchParams({
    offset: String(options.offset ?? 0),
    limit: String(options.limit ?? 20),
  });
  const value = await apiFetch<MarketScreenJobsResponse>(`/api/market-screens?${params}`, {
    signal: options.signal,
  });
  if (
    !record(value) ||
    !Array.isArray(value.jobs) ||
    !value.jobs.every(validMarketScreenJob) ||
    !nonnegativeInteger(value.offset) ||
    !nonnegativeInteger(value.total) ||
    !Number.isInteger(value.limit) ||
    value.limit < 1 ||
    value.limit > 100 ||
    value.jobs.length > value.limit ||
    typeof value.hasMore !== 'boolean'
  )
    throw new Error('Invalid market-screen job list; retry to refresh.');
  return value;
}

export async function getMarketScreen(
  jobId: string,
  options: {
    kind?: MarketScreenResultKind;
    offset?: number;
    limit?: number;
    signal?: AbortSignal;
  } = {}
): Promise<MarketScreenJobSnapshot> {
  const kind = options.kind ?? 'matches';
  const params = new URLSearchParams({
    kind,
    offset: String(options.offset ?? 0),
    limit: String(options.limit ?? 20),
  });
  const value = await apiFetch<unknown>(
    `/api/market-screens/${encodeURIComponent(jobId)}?${params}`,
    { signal: options.signal }
  );
  return checkedMarketScreenSnapshot(value, jobId, kind);
}

async function controlMarketScreen(
  jobId: string,
  action: 'pause' | 'resume',
  signal?: AbortSignal
) {
  const value = await apiFetch<unknown>(
    `/api/market-screens/${encodeURIComponent(jobId)}/${action}`,
    {
      method: 'POST',
      body: '{}',
      signal,
    }
  );
  return checkedMarketScreenSnapshot(value, jobId);
}

export const pauseMarketScreen = (jobId: string, signal?: AbortSignal) =>
  controlMarketScreen(jobId, 'pause', signal);
export const resumeMarketScreen = (jobId: string, signal?: AbortSignal) =>
  controlMarketScreen(jobId, 'resume', signal);

const paperStatuses = new Set([
  'pending',
  'open',
  'completed',
  'unavailable',
  'ineligible',
  'legacy-untracked',
]);
const nullableFinite = (value: unknown) =>
  value === null || (typeof value === 'number' && Number.isFinite(value));
const nullablePrice = (value: unknown) =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0);
const nullableTimestamp = (value: unknown) =>
  value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
const nullableSession = (value: unknown) =>
  value === null ||
  (typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value);

function validPaperRow(value: unknown): value is MarketScreenPerformanceRow {
  if (!record(value)) return false;
  return (
    typeof value.recommendationId === 'string' &&
    typeof value.ticker === 'string' &&
    paperStatuses.has(String(value.status)) &&
    nullableSession(value.dataAsOf) &&
    nullableTimestamp(value.recommendedAt) &&
    nullableTimestamp(value.updatedAt) &&
    nullableSession(value.entryDate) &&
    nullableSession(value.exitDate) &&
    nullablePrice(value.entryPrice) &&
    nullablePrice(value.exitPrice) &&
    nullableFinite(value.grossReturnPct) &&
    nullableFinite(value.netReturnPct) &&
    (value.reason === null || typeof value.reason === 'string') &&
    (value.status === 'completed'
      ? ['win', 'loss', 'breakeven'].includes(String(value.outcome)) &&
        value.netReturnPct !== null &&
        value.grossReturnPct !== null &&
        value.entryDate !== null &&
        value.exitDate !== null &&
        value.entryPrice !== null &&
        value.exitPrice !== null
      : value.outcome === null && value.netReturnPct === null && value.grossReturnPct === null)
  );
}

function checkedPaperSnapshot(value: unknown, jobId: string): MarketScreenPerformanceSnapshot {
  const invalid = () => new Error('Invalid paper-performance response; retry saved outcomes.');
  if (
    !record(value) ||
    value.jobId !== jobId ||
    !nullableTimestamp(value.updatedAt) ||
    !record(value.policy) ||
    !record(value.summary) ||
    !record(value.page) ||
    !record(value.refresh)
  )
    throw invalid();
  const { policy, summary, page, refresh } = value;
  const counts = [
    'totalRecommendations',
    'completed',
    'wins',
    'losses',
    'breakeven',
    'pending',
    'open',
    'unavailable',
    'ineligible',
    'legacyUntracked',
  ];
  if (!counts.every((key) => nonnegativeInteger(summary[key]))) throw invalid();
  const s = summary as unknown as MarketScreenPerformanceSnapshot['summary'];
  if (
    policy.id !== 'us-buy-next-open-five-session-v1' ||
    policy.mode !== 'forward-paper' ||
    policy.timezone !== 'America/New_York' ||
    policy.entry !== 'next-session-open' ||
    policy.exit !== 'fifth-session-close' ||
    policy.horizonSessions !== 5 ||
    policy.costBpsRoundTrip !== 10 ||
    policy.adjustment !== 'same-fetched-adjusted-series' ||
    s.completed !== s.wins + s.losses + s.breakeven ||
    s.totalRecommendations !==
      s.completed + s.pending + s.open + s.unavailable + s.ineligible + s.legacyUntracked ||
    (s.completed === 0
      ? s.winRatePct !== null || s.averageNetReturnPct !== null
      : typeof s.winRatePct !== 'number' ||
        !Number.isFinite(s.winRatePct) ||
        Math.abs(s.winRatePct - (s.wins / s.completed) * 100) > 0.000001 ||
        typeof s.averageNetReturnPct !== 'number' ||
        !Number.isFinite(s.averageNetReturnPct)) ||
    !nonnegativeInteger(page.offset) ||
    !nonnegativeInteger(page.total) ||
    !Number.isInteger(page.limit) ||
    Number(page.limit) < 1 ||
    Number(page.limit) > 100 ||
    typeof page.hasMore !== 'boolean' ||
    !Array.isArray(page.items) ||
    page.items.length > Number(page.limit) ||
    !page.items.every(validPaperRow) ||
    !['idle', 'running'].includes(String(refresh.status)) ||
    !nonnegativeInteger(refresh.selected) ||
    !nonnegativeInteger(refresh.processed) ||
    refresh.processed > refresh.selected ||
    (refresh.reason !== null && typeof refresh.reason !== 'string')
  )
    throw invalid();
  return value as unknown as MarketScreenPerformanceSnapshot;
}

function paperPageOptions(offset: number, limit: number, maximum: number) {
  if (!nonnegativeInteger(offset) || !Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new Error('Invalid paper-performance page or refresh limit.');
  }
}

/** Reads saved outcomes only; this request does not fetch market prices. */
export async function getMarketScreenPerformance(
  jobId: string,
  options: { offset?: number; limit?: number; signal?: AbortSignal } = {}
): Promise<MarketScreenPerformanceSnapshot> {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20;
  paperPageOptions(offset, limit, 100);
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  const value = await apiFetch<unknown>(
    `/api/market-screens/${encodeURIComponent(jobId)}/performance?${params}`,
    { signal: options.signal }
  );
  const snapshot = checkedPaperSnapshot(value, jobId);
  if (snapshot.page.offset !== offset || snapshot.page.limit !== limit)
    throw new Error('Invalid paper-performance response; retry saved outcomes.');
  return snapshot;
}

/** Starts a bounded background price refresh after an explicit user action. */
export async function refreshMarketScreenPerformance(
  jobId: string,
  options: { limit?: number; signal?: AbortSignal } = {}
): Promise<MarketScreenPerformanceSnapshot> {
  const limit = options.limit ?? 20;
  paperPageOptions(0, limit, 50);
  const value = await apiFetch<unknown>(
    `/api/market-screens/${encodeURIComponent(jobId)}/performance/refresh`,
    {
      method: 'POST',
      body: JSON.stringify({ limit }),
      signal: options.signal,
    }
  );
  return checkedPaperSnapshot(value, jobId);
}
