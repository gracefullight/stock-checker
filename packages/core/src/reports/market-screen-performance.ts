import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import { MarketScreenJobNotFoundError } from '@/reports/market-screen';
import {
  acquireMarketScreenLease,
  marketScreenOwnerIsAlive,
  readMarketScreenJson,
  readMarketScreenLease,
  writeMarketScreenJson,
} from '@/reports/market-screen-store';
import type { StockScreenMatch } from '@/reports/stock-screen';

export interface MarketScreenPerformancePolicy {
  id: 'us-buy-next-open-five-session-v1';
  mode: 'forward-paper';
  timezone: 'America/New_York';
  entry: 'next-session-open';
  exit: 'fifth-session-close';
  horizonSessions: 5;
  costBpsRoundTrip: 10;
  adjustment: 'same-fetched-adjusted-series';
}

export type MarketScreenPerformanceStatus =
  | 'pending'
  | 'open'
  | 'completed'
  | 'unavailable'
  | 'ineligible'
  | 'legacy-untracked';

export interface MarketScreenPerformanceRow {
  recommendationId: string;
  ticker: string;
  dataAsOf: string | null;
  recommendedAt: string | null;
  status: MarketScreenPerformanceStatus;
  reason: string | null;
  entryDate: string | null;
  exitDate: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  grossReturnPct: number | null;
  netReturnPct: number | null;
  outcome: 'win' | 'loss' | 'breakeven' | null;
  updatedAt: string | null;
}

export interface MarketScreenPerformanceSummary {
  totalRecommendations: number;
  completed: number;
  wins: number;
  losses: number;
  breakeven: number;
  pending: number;
  open: number;
  unavailable: number;
  ineligible: number;
  legacyUntracked: number;
  winRatePct: number | null;
  averageNetReturnPct: number | null;
}

export interface MarketScreenPerformanceSnapshot {
  jobId: string;
  policy: MarketScreenPerformancePolicy;
  updatedAt: string | null;
  summary: MarketScreenPerformanceSummary;
  page: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
    items: MarketScreenPerformanceRow[];
  };
  refresh: {
    status: 'idle' | 'running';
    selected: number;
    processed: number;
    reason: string | null;
  };
}

export interface MarketScreenPerformanceCandle {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketScreenPerformanceDependencies {
  /** Test-only injections; transport inputs never accept filesystem paths or providers. */
  rootDirectory?: string;
  fetchPrices?: (ticker: string, lookbackDays: number) => Promise<MarketScreenPerformanceCandle[]>;
  now?: () => Date;
  minIntervalMs?: number;
}

export interface MarketScreenPerformanceRegistration {
  schemaVersion: 1;
  policy: MarketScreenPerformancePolicy;
  recommendedAt: string;
  dataAsOf: string | null;
  sessions: string[];
  status: 'pending' | 'ineligible' | 'unavailable';
  reason: string | null;
}

const POLICY: MarketScreenPerformancePolicy = Object.freeze({
  id: 'us-buy-next-open-five-session-v1',
  mode: 'forward-paper',
  timezone: 'America/New_York',
  entry: 'next-session-open',
  exit: 'fifth-session-close',
  horizonSessions: 5,
  costBpsRoundTrip: 10,
  adjustment: 'same-fetched-adjusted-series',
});
const DEFAULT_ROOT = fileURLToPath(new URL('../../../../data/market-scans/', import.meta.url));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const REFRESH_PURPOSE = 'forward-paper-performance';

// Published NYSE calendar, not the proximity helper that counts only weekdays.
// https://www.nyse.com/trade/hours-calendars (2026–2028). Unknown years fail closed.
const HOLIDAYS = new Set([
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
  '2027-05-31',
  '2027-06-18',
  '2027-07-05',
  '2027-09-06',
  '2027-11-25',
  '2027-12-24',
  '2028-01-17',
  '2028-02-21',
  '2028-04-14',
  '2028-05-29',
  '2028-06-19',
  '2028-07-04',
  '2028-09-04',
  '2028-11-23',
  '2028-12-25',
]);
const EARLY_CLOSE = new Set(['2026-11-27', '2026-12-24', '2027-11-26', '2028-07-03', '2028-11-24']);
const at = (date: string, hour: number, minute = 0) =>
  DateTime.fromISO(date, { zone: POLICY.timezone }).set({ hour, minute }).toMillis();
const closeAt = (date: string) => at(date, EARLY_CLOSE.has(date) ? 13 : 16);
const supported = (date: DateTime) => date.isValid && date.year >= 2026 && date.year <= 2028;
const session = (date: DateTime) =>
  supported(date) && date.weekday <= 5 && !HOLIDAYS.has(date.toISODate() as string);

/** Frozen alongside the newly published BUY row; existing rows never receive this marker. */
export function registerMarketScreenRecommendation(
  dataAsOf: string | null,
  recommendedAt: string
): MarketScreenPerformanceRegistration {
  const registration: MarketScreenPerformanceRegistration = {
    schemaVersion: 1,
    policy: { ...POLICY },
    recommendedAt,
    dataAsOf,
    sessions: [],
    status: 'pending',
    reason: null,
  };
  const date =
    typeof dataAsOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dataAsOf)
      ? DateTime.fromISO(dataAsOf, { zone: POLICY.timezone })
      : null;
  const publication = DateTime.fromISO(recommendedAt, { setZone: true });
  if (
    !date ||
    !supported(date) ||
    !publication.isValid ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(recommendedAt)
  ) {
    registration.status = 'unavailable';
    registration.reason =
      'A verified signal timestamp and published NYSE calendar (2026–2028) are required.';
    return registration;
  }
  if (!session(date) || publication.toMillis() < closeAt(dataAsOf as string)) {
    registration.status = 'ineligible';
    registration.reason =
      'The recommendation was not published after a completed US signal session.';
    return registration;
  }
  let next = date;
  while (registration.sessions.length < POLICY.horizonSessions) {
    next = next.plus({ days: 1 });
    if (!supported(next)) {
      registration.status = 'unavailable';
      registration.reason =
        'The required holding window is outside the verified NYSE calendar (2026–2028).';
      registration.sessions = [];
      return registration;
    }
    if (session(next)) registration.sessions.push(next.toISODate() as string);
  }
  if (publication.toMillis() >= at(registration.sessions[0], 9, 30)) {
    registration.status = 'ineligible';
    registration.reason =
      'The scheduled entry open had already occurred when this BUY was published.';
  }
  return registration;
}

interface Recommendation {
  index: number;
  registration: MarketScreenPerformanceRegistration | null;
  row: MarketScreenPerformanceRow;
}
interface RefreshState {
  token: string;
  selected: number;
  processed: number;
  updatedAt: string;
  reason: string | null;
}
const file = (root: string, id: string, name: string) => path.join(root, id, name);
const ledgerFile = (root: string, id: string, index: number) =>
  file(root, id, `performance/${String(index).padStart(8, '0')}.json`);
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const positive = (value: number) => Number.isFinite(value) && value > 0;

function validatedId(id: string): string {
  if (typeof id !== 'string' || !UUID.test(id)) throw new TypeError('jobId must be a UUID');
  return id.toLowerCase();
}
function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum)
    throw new TypeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  return value as number;
}
function now(dependencies: MarketScreenPerformanceDependencies): Date {
  const value = dependencies.now?.() ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new TypeError('Invalid refresh time');
  return value;
}
async function rootDirectory(dependencies: MarketScreenPerformanceDependencies): Promise<string> {
  const requested = dependencies.rootDirectory ?? DEFAULT_ROOT;
  if (!path.isAbsolute(requested))
    throw new TypeError('Market-screen store must use an absolute path');
  try {
    return await realpath(requested);
  } catch (error) {
    if (missing(error)) throw new MarketScreenJobNotFoundError();
    throw error;
  }
}

async function recommendations(root: string, id: string): Promise<Recommendation[]> {
  let manifest: { id: string; tickers: string[] };
  try {
    manifest = (await readMarketScreenJson(file(root, id, 'manifest.json'))) as typeof manifest;
  } catch (error) {
    if (missing(error)) throw new MarketScreenJobNotFoundError();
    throw new Error('Saved market-screen recommendations are unreadable.');
  }
  if (manifest.id !== id || !Array.isArray(manifest.tickers))
    throw new Error('Saved market-screen recommendations are unreadable.');
  const entries = await readdir(file(root, id, 'results/matches'), { withFileTypes: true });
  const rows: Recommendation[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !/^\d{8}\.json$/.test(entry.name)) continue;
    const saved = (await readMarketScreenJson(file(root, id, `results/matches/${entry.name}`))) as {
      index: number;
      kind: string;
      completedAt: string;
      item: StockScreenMatch;
      forwardPerformance?: MarketScreenPerformanceRegistration;
    };
    if (
      saved.kind !== 'matches' ||
      !saved.item ||
      saved.item.ticker !== manifest.tickers[saved.index] ||
      entry.name !== `${String(saved.index).padStart(8, '0')}.json`
    )
      throw new Error('Saved market-screen recommendations are unreadable.');
    if (saved.item.decision !== 'BUY') continue;
    const registration = saved.forwardPerformance ?? null;
    if (registration) {
      const expected = registerMarketScreenRecommendation(saved.item.dataAsOf, saved.completedAt);
      if (JSON.stringify(registration) !== JSON.stringify(expected))
        throw new Error('The frozen recommendation policy is unreadable.');
    }
    let row: MarketScreenPerformanceRow = {
      recommendationId: `${id}:${saved.index}`,
      ticker: saved.item.ticker,
      dataAsOf: saved.item.dataAsOf,
      recommendedAt: registration?.recommendedAt ?? null,
      status: registration?.status ?? 'legacy-untracked',
      reason:
        registration?.reason ??
        (registration
          ? null
          : 'This BUY predates forward paper tracking and is excluded from the forward validation sample.'),
      entryDate: registration?.sessions[0] ?? null,
      exitDate: registration?.sessions[4] ?? null,
      entryPrice: null,
      exitPrice: null,
      grossReturnPct: null,
      netReturnPct: null,
      outcome: null,
      updatedAt: null,
    };
    if (registration) {
      try {
        const cached = (await readMarketScreenJson(
          ledgerFile(root, id, saved.index)
        )) as MarketScreenPerformanceRow;
        if (
          cached.recommendationId !== row.recommendationId ||
          cached.ticker !== row.ticker ||
          cached.recommendedAt !== row.recommendedAt ||
          cached.dataAsOf !== row.dataAsOf ||
          cached.entryDate !== row.entryDate ||
          cached.exitDate !== row.exitDate ||
          !['pending', 'open', 'completed', 'unavailable', 'ineligible'].includes(cached.status) ||
          (cached.status === 'completed' &&
            (!positive(cached.entryPrice as number) ||
              !positive(cached.exitPrice as number) ||
              !Number.isFinite(cached.grossReturnPct) ||
              !Number.isFinite(cached.netReturnPct) ||
              !['win', 'loss', 'breakeven'].includes(cached.outcome as string))) ||
          (cached.status !== 'completed' &&
            (cached.outcome !== null ||
              cached.netReturnPct !== null ||
              cached.grossReturnPct !== null))
        )
          throw new Error('Invalid cached performance');
        row = cached;
      } catch (error) {
        if (!missing(error)) throw new Error('Cached paper performance is unreadable.');
      }
    }
    rows.push({ index: saved.index, registration, row });
  }
  return rows;
}

async function snapshot(
  root: string,
  id: string,
  offset: number,
  limit: number
): Promise<MarketScreenPerformanceSnapshot> {
  const all = (await recommendations(root, id)).map((item) => item.row);
  const summary: MarketScreenPerformanceSummary = {
    totalRecommendations: all.length,
    completed: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    pending: 0,
    open: 0,
    unavailable: 0,
    ineligible: 0,
    legacyUntracked: 0,
    winRatePct: null,
    averageNetReturnPct: null,
  };
  let averageNet = 0;
  let updatedAt: string | null = null;
  for (const row of all) {
    if (row.updatedAt && (!updatedAt || row.updatedAt > updatedAt)) updatedAt = row.updatedAt;
    if (row.status === 'legacy-untracked') summary.legacyUntracked++;
    else summary[row.status]++;
    if (row.status === 'completed') {
      if (row.outcome === 'win') summary.wins++;
      if (row.outcome === 'loss') summary.losses++;
      if (row.outcome === 'breakeven') summary.breakeven++;
      averageNet += ((row.netReturnPct as number) - averageNet) / summary.completed;
    }
  }
  if (summary.completed) {
    summary.winRatePct = (summary.wins / summary.completed) * 100;
    summary.averageNetReturnPct = averageNet;
  }
  let refresh: MarketScreenPerformanceSnapshot['refresh'] = {
    status: 'idle',
    selected: 0,
    processed: 0,
    reason: null,
  };
  try {
    const state = (await readMarketScreenJson(
      file(root, id, 'performance/refresh.json')
    )) as RefreshState;
    const lease = await readMarketScreenLease(root);
    const running =
      lease?.token === state.token &&
      lease.purpose === REFRESH_PURPOSE &&
      marketScreenOwnerIsAlive(lease);
    refresh = {
      status: running ? 'running' : 'idle',
      selected: state.selected,
      processed: state.processed,
      reason:
        running || state.processed === state.selected
          ? state.reason
          : (state.reason ??
            'The previous refresh stopped; explicitly refresh to continue uncaptured outcomes.'),
    };
    if (!updatedAt || state.updatedAt > updatedAt) updatedAt = state.updatedAt;
  } catch (error) {
    if (!missing(error)) throw new Error('Cached paper performance refresh is unreadable.');
  }
  return {
    jobId: id,
    policy: { ...POLICY },
    updatedAt,
    summary,
    page: {
      offset,
      limit,
      total: all.length,
      hasMore: offset + limit < all.length,
      items: all.slice(offset, offset + limit),
    },
    refresh,
  };
}

/** A disk-only view: reading never fetches market data or starts a worker. */
export async function getMarketScreenPerformance(
  id: string,
  options: { offset?: number; limit?: number } = {},
  dependencies: MarketScreenPerformanceDependencies = {}
): Promise<MarketScreenPerformanceSnapshot> {
  const jobId = validatedId(id);
  const offset = integer(options.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset');
  const limit = integer(options.limit, 20, 1, 100, 'limit');
  return snapshot(await rootDirectory(dependencies), jobId, offset, limit);
}

function completedBars(
  candles: MarketScreenPerformanceCandle[],
  timestamp: number
): Map<string, MarketScreenPerformanceCandle> {
  const bars = new Map<string, MarketScreenPerformanceCandle>();
  for (const candle of candles) {
    if (!(candle.date instanceof Date) || !Number.isFinite(candle.date.getTime())) continue;
    // Core prices already use UTC midnight to encode the NY session date.
    const date = candle.date.toISOString().slice(0, 10);
    if (!session(DateTime.fromISO(date, { zone: POLICY.timezone })) || closeAt(date) > timestamp)
      continue;
    if (
      ![candle.open, candle.high, candle.low, candle.close].every(positive) ||
      !Number.isFinite(candle.volume) ||
      candle.volume < 0 ||
      candle.low > Math.min(candle.open, candle.close) ||
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > candle.high
    )
      continue;
    if (bars.has(date)) throw new Error('Duplicate market session data');
    bars.set(date, candle);
  }
  return bars;
}

function evaluate(
  recommendation: Recommendation,
  spy: Map<string, MarketScreenPerformanceCandle>,
  candles: MarketScreenPerformanceCandle[],
  timestamp: Date
): MarketScreenPerformanceRow {
  const row = { ...recommendation.row, updatedAt: timestamp.toISOString(), reason: null };
  const sessions = recommendation.registration?.sessions ?? [];
  const instant = timestamp.getTime();
  if (sessions.length !== 5)
    return {
      ...row,
      status: 'unavailable',
      reason: 'A verified five-session calendar window is unavailable.',
    };
  if (instant < at(sessions[0], 9, 30)) return { ...row, status: 'pending' };
  const expected = sessions.filter((date) => closeAt(date) <= instant);
  const bars = completedBars(candles, instant);
  if (expected.some((date) => !spy.has(date) || !bars.has(date))) {
    return {
      ...row,
      status: 'unavailable',
      reason:
        'Required completed benchmark or ticker sessions are missing; the holding window was not shifted.',
    };
  }
  if (expected.length < 5) {
    return {
      ...row,
      status: 'open',
      entryPrice: bars.get(sessions[0])?.open ?? null,
      exitPrice: null,
      reason:
        expected.length === 0
          ? 'The entry session is still incomplete; its paper entry price has not been observed.'
          : null,
    };
  }
  const entryPrice = (bars.get(sessions[0]) as MarketScreenPerformanceCandle).open;
  const exitPrice = (bars.get(sessions[4]) as MarketScreenPerformanceCandle).close;
  const grossReturnPct = (exitPrice / entryPrice - 1) * 100;
  const calculated = grossReturnPct - POLICY.costBpsRoundTrip / 100;
  if (!Number.isFinite(grossReturnPct) || !Number.isFinite(calculated))
    throw new Error('The paper return cannot be represented as a finite number');
  const netReturnPct = Math.abs(calculated) < 1e-9 ? 0 : calculated;
  return {
    ...row,
    status: 'completed',
    entryPrice,
    exitPrice,
    grossReturnPct,
    netReturnPct,
    outcome: netReturnPct > 0 ? 'win' : netReturnPct < 0 ? 'loss' : 'breakeven',
  };
}

async function defaultFetchPrices(
  ticker: string,
  lookbackDays: number
): Promise<MarketScreenPerformanceCandle[]> {
  const { getHistoricalPrices } = await import('@/services/data-fetcher');
  return getHistoricalPrices(ticker, lookbackDays);
}

/** Launch a bounded background refresh, returning promptly; GET observes cached progress. */
export async function refreshMarketScreenPerformance(
  id: string,
  options: { limit?: number } = {},
  dependencies: MarketScreenPerformanceDependencies = {}
): Promise<MarketScreenPerformanceSnapshot> {
  const jobId = validatedId(id);
  const limit = integer(options.limit, 20, 1, 50, 'limit');
  const minIntervalMs = integer(dependencies.minIntervalMs, 1000, 0, 60_000, 'minIntervalMs');
  now(dependencies);
  const root = await rootDirectory(dependencies);
  await recommendations(root, jobId);
  const lease = await acquireMarketScreenLease(root, jobId, REFRESH_PURPOSE);
  if (!lease.acquired) {
    const result = await snapshot(root, jobId, 0, 20);
    if (result.refresh.status !== 'running')
      result.refresh.reason =
        'Another market-data job owns the worker budget; refresh again after it finishes.';
    return result;
  }
  let selected: Recommendation[];
  let state: RefreshState;
  try {
    selected = (await recommendations(root, jobId))
      .filter((item) => ['pending', 'open', 'unavailable'].includes(item.row.status))
      .sort(
        (a, b) => (a.row.updatedAt ?? '').localeCompare(b.row.updatedAt ?? '') || a.index - b.index
      )
      .slice(0, limit);
    state = {
      token: lease.owner.token,
      selected: selected.length,
      processed: 0,
      updatedAt: now(dependencies).toISOString(),
      reason: null,
    };
    await writeMarketScreenJson(file(root, jobId, 'performance/refresh.json'), state);
  } catch (error) {
    await lease.release();
    throw error;
  }
  const execute = async () => {
    const fetchPrices = dependencies.fetchPrices ?? defaultFetchPrices;
    let lastStart = 0;
    const fetch = async (ticker: string, days: number) => {
      const delay = Math.max(0, minIntervalMs - (Date.now() - lastStart));
      if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      lastStart = Date.now();
      return fetchPrices(ticker, days);
    };
    try {
      const instant = now(dependencies);
      const due = selected.filter(
        (item) =>
          item.registration?.sessions.length === 5 &&
          instant.getTime() >= closeAt(item.registration.sessions[0])
      );
      const earliest = due.reduce(
        (minimum, item) => Math.min(minimum, Date.parse(`${item.row.dataAsOf}T00:00:00Z`)),
        instant.getTime()
      );
      const days = Math.max(
        30,
        Math.min(3650, Math.ceil((instant.getTime() - earliest) / 86_400_000) + 10)
      );
      let spy = new Map<string, MarketScreenPerformanceCandle>();
      let benchmarkFailed = false;
      if (due.length) {
        try {
          spy = completedBars(await fetch('SPY', days), now(dependencies).getTime());
        } catch {
          benchmarkFailed = true;
        }
      }
      let failures = 0;
      for (const item of selected) {
        let row: MarketScreenPerformanceRow;
        const time = now(dependencies);
        const sessions = item.registration?.sessions ?? [];
        try {
          const requiresPrices = sessions.length === 5 && time.getTime() >= closeAt(sessions[0]);
          if (requiresPrices && (benchmarkFailed || spy.size === 0))
            throw new Error('Benchmark unavailable');
          const prices = requiresPrices ? await fetch(item.row.ticker, days) : [];
          row = evaluate(item, spy, prices, time);
        } catch {
          row = {
            ...item.row,
            status: 'unavailable',
            outcome: null,
            grossReturnPct: null,
            netReturnPct: null,
            exitPrice: null,
            reason:
              'Market data could not verify the frozen paper holding window; explicitly refresh to retry.',
            updatedAt: time.toISOString(),
          };
        }
        await writeMarketScreenJson(ledgerFile(root, jobId, item.index), row);
        state.processed++;
        state.updatedAt = time.toISOString();
        failures = row.status === 'unavailable' ? failures + 1 : 0;
        if (failures >= 5)
          state.reason =
            'Repeated unavailable data stopped this refresh; no unavailable recommendation was counted as a loss.';
        await writeMarketScreenJson(file(root, jobId, 'performance/refresh.json'), state);
        if (failures >= 5) break;
      }
    } catch {
      state.reason =
        'The paper performance checkpoint could not be saved; explicitly refresh to continue.';
    } finally {
      try {
        await writeMarketScreenJson(file(root, jobId, 'performance/refresh.json'), state);
      } finally {
        await lease.release();
      }
    }
  };
  void execute().catch(() => {});
  return snapshot(root, jobId, 0, 20);
}
