import type {
  MarketScreenError,
  MarketScreenJob,
  MarketScreenJobSnapshot,
} from '@stock-checker/core/src/reports/market-screen.ts';
import type { StockScreenMatch } from '@stock-checker/core/src/reports/stock-screen.ts';
import type { TickerResult } from '@stock-checker/core/src/types';
import axios, { type AxiosError } from 'axios';

// Server components can use the non-public env var to avoid exposing internal
// addresses. Clients only see NEXT_PUBLIC_* so the fallback chain is:
//   process.env.API_URL (server-only)  →  process.env.NEXT_PUBLIC_API_URL  →  localhost
const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5101';

export type { MarketScreenJob, MarketScreenJobSnapshot, TickerResult };

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
