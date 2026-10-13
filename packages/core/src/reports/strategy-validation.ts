import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { DEFAULT_ROUND_TRIP_COST_PCT } from '@/constants';
import { TICKER_SECTOR_ETF } from '@/constants/tickers';
import {
  type BacktestSignal,
  type BacktestTrade,
  buildEquityCurve,
  buildTickerContext,
  type Candle,
  type EvaluationWindow,
  measure5DayWinRate,
  runSignalsWithContext,
  splitSignalsByExecutionDate,
} from '@/optimization/engine';
import { writeMarketScreenJson } from '@/reports/market-screen-store';
import type { PipelineConfig } from '@/types';
import { stableJson, strategyConfigFingerprint } from '@/utils/config-fingerprint';
import {
  CANONICAL_STRATEGY_ID,
  loadPipelineConfig,
  PIPELINE_CONFIG_VERSION,
} from '@/utils/config-loader';
import { bootstrapMeanInterval, mean, percentile, wilsonInterval } from '@/utils/statistics';

export { strategyConfigFingerprint } from '@/utils/config-fingerprint';

const PROJECT_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SOURCE_FILES = [
  'packages/core/src/optimization/engine.ts',
  'packages/core/src/services/pipeline.ts',
  'packages/core/src/services/analysis.ts',
  'packages/core/src/services/confluence.ts',
  'packages/core/src/services/gaussian-channel.ts',
  'packages/core/src/services/institutional.ts',
  'packages/core/src/services/patterns.ts',
  'packages/core/src/services/reversal-confirm.ts',
  'packages/core/src/services/trend-gate.ts',
  'packages/core/src/constants.ts',
  'packages/core/src/constants/tickers.ts',
  'packages/core/src/utils/config-loader.ts',
  'packages/core/src/reports/strategy-validation.ts',
  'packages/core/src/reports/strategy-validation-worker.ts',
  'bun.lock',
] as const;

function freezeConfig(config: PipelineConfig): PipelineConfig {
  const copy = structuredClone(config);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  };
  freeze(copy);
  return copy;
}

// ISO conversion dominates the historical benchmark alignment loop. Cache the
// same string locally without changing global Date behavior or any model input.
class SessionDate extends Date {
  private cachedTime = Number.NaN;
  private cachedIso = '';
  override toISOString(): string {
    const time = this.getTime();
    if (time !== this.cachedTime) {
      this.cachedIso = super.toISOString();
      this.cachedTime = time;
    }
    return this.cachedIso;
  }
}

export function parseStrategyCandles(value: unknown): Candle[] {
  if (!Array.isArray(value)) throw new TypeError('Expected cached daily candles');
  let previous = -Infinity;
  return value.map((row: Record<string, unknown>) => {
    if (!row || typeof row !== 'object' || typeof row.date !== 'string')
      throw new TypeError('Invalid daily candle');
    const date = new SessionDate(row.date);
    const time = date.getTime();
    if (!Number.isFinite(time) || time <= previous)
      throw new TypeError('Daily candles must have unique increasing dates');
    previous = time;
    const number = (name: string, positive = true) => {
      const result = row[name];
      if (
        typeof result !== 'number' ||
        !Number.isFinite(result) ||
        (positive ? result <= 0 : result < 0)
      )
        throw new TypeError('Invalid daily price or volume');
      return result;
    };
    const open = number('open'),
      high = number('high'),
      low = number('low'),
      close = number('close');
    if (
      low > high ||
      Math.min(open, close) < low - high * 0.00001 ||
      Math.max(open, close) > high * 1.00001
    )
      throw new TypeError('Inconsistent daily OHLC');
    return {
      date,
      open,
      high,
      low,
      close,
      volume: number('volume', false),
      ...(row.adjClose === undefined ? {} : { adjClose: number('adjClose') }),
      ...(row.dollarVolume === undefined ? {} : { dollarVolume: number('dollarVolume', false) }),
    };
  });
}

interface ExecutedTrade extends BacktestTrade {
  ticker: string;
}

function tradeStatistics(trades: Array<{ returnPct: number }>) {
  const wins = trades.filter((trade) => trade.returnPct > 0).length;
  return {
    trades: trades.length,
    wins,
    winRatePct: trades.length ? (wins / trades.length) * 100 : null,
    meanNetReturnPct: trades.length
      ? trades.reduce((sum, trade) => sum + trade.returnPct, 0) / trades.length
      : null,
  };
}

const ENTRY_PRICE_TIERS: Array<{ tier: string; from: number; to: number }> = [
  { tier: '<10', from: 0, to: 10 },
  { tier: '10-50', from: 10, to: 50 },
  { tier: '50-200', from: 50, to: 200 },
  { tier: '>=200', from: 200, to: Infinity },
];
const DOLLAR_VOLUME_TIERS: Array<{ tier: string; from: number; to: number }> = [
  { tier: '<50M', from: 0, to: 50e6 },
  { tier: '50M-200M', from: 50e6, to: 200e6 },
  { tier: '200M-1B', from: 200e6, to: 1e9 },
  { tier: '>=1B', from: 1e9, to: Infinity },
];

function tierBreakdown(
  trades: Array<ExecutedTrade & { tierValue: number | null }>,
  tiers: Array<{ tier: string; from: number; to: number }>
) {
  const rows = tiers.map(({ tier, from, to }) => ({
    tier,
    ...tradeStatistics(
      trades.filter(
        (trade) => trade.tierValue !== null && trade.tierValue >= from && trade.tierValue < to
      )
    ),
  }));
  return {
    tiers: rows,
    unavailable: trades.filter((trade) => trade.tierValue === null).length,
  };
}

export interface StrategyMeasurementOptions {
  /** Benchmark bars for matched windows, the exposure calendar and buy-and-hold. */
  spy?: Candle[];
  /** Round-trip costs to re-price every executed trade with (bps). */
  costSensitivityBps?: number[];
  bootstrapResamples?: number;
  bootstrapSeed?: number;
  /** Slot counts for the single-account simulation. */
  accountSlots?: number[];
  initialCapital?: number;
}

/**
 * One account with K equal cash slots following the executed trades in entry
 * order (ties by ticker). A trade is taken only if a slot is free at its entry
 * open; idle slots hold cash. Positions are marked at each session close.
 */
function simulateAccount(
  trades: ExecutedTrade[],
  prices: Map<string, Candle[]>,
  calendar: string[],
  slots: number,
  initialCapital: number
) {
  const closes = new Map<string, Map<string, number>>();
  for (const [ticker, rows] of prices)
    closes.set(
      ticker,
      new Map(rows.map((row) => [row.date.toISOString().slice(0, 10), row.close]))
    );
  const ordered = [...trades].sort(
    (left, right) =>
      left.entryDate.localeCompare(right.entryDate) || left.ticker.localeCompare(right.ticker)
  );
  const slotCash = Array.from({ length: slots }, () => initialCapital / slots);
  const holding: Array<(ExecutedTrade & { lastMark: number }) | null> = Array.from(
    { length: slots },
    () => null
  );
  let cursor = 0;
  let taken = 0,
    skipped = 0,
    peak = initialCapital,
    maxDrawdownPct = 0,
    equity = initialCapital;
  for (const date of calendar) {
    while (cursor < ordered.length && ordered[cursor].entryDate <= date) {
      const trade = ordered[cursor++];
      if (trade.entryDate !== date) {
        skipped++;
        continue;
      }
      const free = holding.indexOf(null);
      if (free === -1) {
        skipped++;
        continue;
      }
      holding[free] = { ...trade, lastMark: slotCash[free] };
      taken++;
    }
    equity = 0;
    for (let slot = 0; slot < slots; slot++) {
      const position = holding[slot];
      if (!position) {
        equity += slotCash[slot];
        continue;
      }
      if (position.exitDate === date) {
        slotCash[slot] *= 1 + position.returnPct / 100;
        holding[slot] = null;
        equity += slotCash[slot];
        continue;
      }
      const close = closes.get(position.ticker)?.get(date);
      if (close !== undefined) position.lastMark = slotCash[slot] * (close / position.entryPrice);
      equity += position.lastMark;
    }
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / peak) * 100);
  }
  const years = calendar.length
    ? (Date.parse(calendar.at(-1) as string) - Date.parse(calendar[0])) / 31_557_600_000
    : 0;
  const totalReturnPct = (equity / initialCapital - 1) * 100;
  return {
    slots,
    tradesTaken: taken,
    tradesSkipped: skipped,
    totalReturnPct,
    cagrPct: years > 0 ? ((equity / initialCapital) ** (1 / years) - 1) * 100 : null,
    maxDrawdownPct,
  };
}

function buyAndHold(rows: Candle[], calendar: string[], costPct: number) {
  const byDate = new Map(rows.map((row) => [row.date.toISOString().slice(0, 10), row]));
  const first = byDate.get(calendar[0]);
  const last = byDate.get(calendar.at(-1) as string);
  if (!first || !last) return null;
  let peak = first.open,
    maxDrawdownPct = 0;
  for (const date of calendar) {
    const close = byDate.get(date)?.close;
    if (close === undefined) continue;
    peak = Math.max(peak, close);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - close) / peak) * 100);
  }
  const years = (Date.parse(calendar.at(-1) as string) - Date.parse(calendar[0])) / 31_557_600_000;
  const totalReturnPct = (last.close / first.open - 1) * 100 - costPct;
  return {
    entryDate: calendar[0],
    exitDate: calendar.at(-1) as string,
    totalReturnPct,
    cagrPct: years > 0 ? ((1 + totalReturnPct / 100) ** (1 / years) - 1) * 100 : null,
    maxDrawdownPct,
  };
}

export function measureStrategyValidation(
  signals: BacktestSignal[],
  prices: Map<string, Candle[]>,
  costPct = DEFAULT_ROUND_TRIP_COST_PCT,
  options: StrategyMeasurementOptions = {}
) {
  const buys = signals.filter((signal) => signal.decision === 'BUY');
  const curves = [...prices].map(([ticker, rows]) => ({
    ticker,
    curve: buildEquityCurve(
      buys.filter((signal) => signal.ticker === ticker),
      rows,
      5,
      10_000,
      costPct
    ),
  }));
  const executed: ExecutedTrade[] = curves.flatMap(({ ticker, curve }) =>
    curve.trades.map((trade) => ({ ticker, ...trade }))
  );
  const boundary = new Date('2025-01-01T00:00:00Z');
  const split = splitSignalsByExecutionDate(buys, prices, boundary);
  const period = (
    selected: BacktestSignal[],
    window: EvaluationWindow = {},
    purgeCrossing = false
  ) => {
    const observations = measure5DayWinRate(selected, prices, costPct, window);
    const inWindow = executed.filter(
      (trade) =>
        (!window.start || new Date(trade.entryDate) >= window.start) &&
        (!window.end || new Date(trade.entryDate) <= window.end) &&
        (!purgeCrossing || new Date(trade.exitDate) < boundary)
    );
    return {
      observations: {
        samples: observations.totalSignals,
        wins: observations.wins,
        winRatePct: observations.totalSignals ? observations.winRate5d : null,
        meanNetReturnPct: observations.totalSignals ? observations.avgReturn : null,
      },
      nonOverlappingTrades: tradeStatistics(inWindow),
    };
  };
  const allDates = [...prices.values()].flatMap((rows) =>
    rows.map((row) => row.date.getUTCFullYear())
  );
  const annual = Object.fromEntries(
    [...new Set(allDates)].sort().map((year) => [
      year,
      period(buys, {
        start: new Date(Date.UTC(year, 0, 1)),
        end: new Date(Date.UTC(year + 1, 0, 1) - 1),
      }),
    ])
  );
  const entryDates = executed.map((trade) => trade.entryDate).sort();
  const exitDates = executed.map((trade) => trade.exitDate).sort();
  const firstEntry = entryDates[0] ?? null;
  const lastExit = exitDates.at(-1) ?? null;
  const iso = (row: Candle) => row.date.toISOString().slice(0, 10);

  // Session calendar for exposure and the account: SPY when supplied, else the union of tickers.
  const spy = options.spy?.length ? options.spy : null;
  const calendarSource = spy
    ? spy.map(iso)
    : [...new Set([...prices.values()].flatMap((rows) => rows.map(iso)))].sort();
  const calendar =
    firstEntry && lastExit
      ? calendarSource.filter((date) => date >= firstEntry && date <= lastExit)
      : [];

  // Per-trade context: bar indexes, excursions and liquidity at the signal.
  const indexByTicker = new Map(
    [...prices].map(([ticker, rows]) => [
      ticker,
      new Map(rows.map((row, index) => [iso(row), index])),
    ])
  );
  const enriched = executed.map((trade) => {
    const rows = prices.get(trade.ticker) ?? [];
    const entryIdx = indexByTicker.get(trade.ticker)?.get(trade.entryDate);
    const exitIdx = indexByTicker.get(trade.ticker)?.get(trade.exitDate);
    let maePct: number | null = null,
      mfePct: number | null = null,
      averageDollarVolume20: number | null = null;
    if (entryIdx !== undefined && exitIdx !== undefined && exitIdx >= entryIdx) {
      const held = rows.slice(entryIdx, exitIdx + 1);
      maePct = Math.min(0, (Math.min(...held.map((row) => row.low)) / trade.entryPrice - 1) * 100);
      mfePct = Math.max(0, (Math.max(...held.map((row) => row.high)) / trade.entryPrice - 1) * 100);
      const window = rows.slice(Math.max(0, entryIdx - 21), entryIdx - 1);
      averageDollarVolume20 = mean(window.map((row) => row.dollarVolume ?? row.close * row.volume));
    }
    return { ...trade, maePct, mfePct, averageDollarVolume20 };
  });

  // Matched SPY windows: SPY open on the entry session to SPY close on the exit session, same cost.
  const spyByDate = spy ? new Map(spy.map((row) => [iso(row), row])) : null;
  const matched = spyByDate
    ? executed.flatMap((trade) => {
        const entry = spyByDate.get(trade.entryDate);
        const exit = spyByDate.get(trade.exitDate);
        if (!entry || !exit) return [];
        const spyGrossReturnPct = (exit.close / entry.open - 1) * 100;
        const spyNetReturnPct = spyGrossReturnPct - costPct;
        return [
          {
            ...trade,
            spyGrossReturnPct,
            spyNetReturnPct,
            excessReturnPct: trade.returnPct - spyNetReturnPct,
          },
        ];
      })
    : [];
  const excess = matched.map((trade) => trade.excessReturnPct);
  const benchmarks = {
    method:
      'SPY bought at the open of each trade entry session and sold at the close of its exit session, charged the same round-trip cost; excess = trade net − SPY net',
    spy: spyByDate
      ? {
          matchedWindows: {
            ...tradeStatistics(matched.map((trade) => ({ returnPct: trade.spyNetReturnPct }))),
            meanGrossReturnPct: mean(matched.map((trade) => trade.spyGrossReturnPct)),
            unmatched: executed.length - matched.length,
          },
          excess: {
            samples: excess.length,
            meanPct: mean(excess),
            meanVsGrossSpyPct: mean(
              matched.map((trade) => trade.returnPct - trade.spyGrossReturnPct)
            ),
            tradesBeatingSpy: excess.filter((value) => value > 0).length,
            tradesBeatingSpyPct: excess.length
              ? (excess.filter((value) => value > 0).length / excess.length) * 100
              : null,
            bootstrap95: bootstrapMeanInterval(excess, {
              resamples: options.bootstrapResamples,
              seed: options.bootstrapSeed,
            }),
          },
        }
      : null,
  };

  // Exposure on the session calendar between the first entry and the last exit.
  const concurrent = new Map<string, number>();
  for (const trade of executed)
    for (const date of calendar)
      if (date >= trade.entryDate && date <= trade.exitDate)
        concurrent.set(date, (concurrent.get(date) ?? 0) + 1);
  const exposure = {
    calendar: spy ? 'SPY sessions' : 'union of evaluated ticker sessions',
    sessions: calendar.length,
    sessionsWithPosition: concurrent.size,
    exposurePct: calendar.length ? (concurrent.size / calendar.length) * 100 : null,
    maxConcurrentPositions: concurrent.size ? Math.max(...concurrent.values()) : 0,
    distinctEntrySessions: new Set(entryDates).size,
  };

  const costSensitivity = (options.costSensitivityBps ?? [10, 20, 30]).map((costBps) => ({
    costBps,
    ...tradeStatistics(
      executed.map((trade) => ({ returnPct: trade.returnPct + costPct - costBps / 100 }))
    ),
  }));

  const mae = enriched.flatMap((trade) => (trade.maePct === null ? [] : [trade.maePct]));
  const mfe = enriched.flatMap((trade) => (trade.mfePct === null ? [] : [trade.mfePct]));
  const excursions = {
    method:
      'Lowest low and highest high from the entry session through the exit session, relative to the entry open; gross of costs',
    samples: mae.length,
    unavailable: executed.length - mae.length,
    maePct: { mean: mean(mae), median: percentile(mae, 0.5), worstDecile: percentile(mae, 0.1) },
    mfePct: { mean: mean(mfe), median: percentile(mfe, 0.5), bestDecile: percentile(mfe, 0.9) },
  };

  const tiers = {
    entryPrice: {
      basis: 'Adjusted entry open on the fetched series (today’s share basis)',
      ...tierBreakdown(
        enriched.map((trade) => ({ ...trade, tierValue: trade.entryPrice })),
        ENTRY_PRICE_TIERS
      ),
    },
    averageDollarVolume20: {
      basis: 'Mean dollar volume over the 20 sessions before the signal session',
      ...tierBreakdown(
        enriched.map((trade) => ({ ...trade, tierValue: trade.averageDollarVolume20 })),
        DOLLAR_VOLUME_TIERS
      ),
    },
  };

  const initialCapital = options.initialCapital ?? 10_000;
  const account = {
    capitalAllocation:
      'One account split into K equal cash slots; a trade is taken only when a slot is free at its entry open, in entry-date then ticker order; idle slots hold cash; marks use session closes; costs are charged at exit',
    initialCapital,
    span: {
      start: calendar[0] ?? null,
      end: calendar.at(-1) ?? null,
      sessions: calendar.length,
    },
    slots: (options.accountSlots ?? [1, 3, 5]).map((slots) =>
      simulateAccount(executed, prices, calendar, slots, initialCapital)
    ),
    spyBuyAndHold: spy && calendar.length ? buyAndHold(spy, calendar, costPct) : null,
  };

  const full = period(buys);
  return {
    rawBuySetups: buys.length,
    full,
    before2025: period(split.train, { end: new Date(boundary.getTime() - 1) }, true),
    since2025: period(split.holdout, { start: boundary }),
    boundaryPurged: split.purged.length,
    annual,
    confidence: {
      winRateWilson95: wilsonInterval(
        full.nonOverlappingTrades.wins,
        full.nonOverlappingTrades.trades
      ),
      meanNetBootstrap95: bootstrapMeanInterval(
        executed.map((trade) => trade.returnPct),
        { resamples: options.bootstrapResamples, seed: options.bootstrapSeed }
      ),
      note: 'Trades are resampled as independent; same-day entries share a market window, so the true intervals are wider.',
    },
    benchmarks,
    exposure,
    costSensitivity,
    excursions,
    tiers,
    account,
    executionRange: {
      firstEntry,
      lastEntry: entryDates.at(-1) ?? null,
      lastExit,
    },
    executedTrades: enriched
      .map(({ averageDollarVolume20: _adv, ...trade }) => trade)
      .sort(
        (left, right) =>
          left.entryDate.localeCompare(right.entryDate) || left.ticker.localeCompare(right.ticker)
      ),
  };
}

export interface StrategyValidationOptions {
  datasetDirectory: string;
  outputFile?: string;
  configPath?: string;
  tickers?: string[];
  workers?: number;
}

export interface StrategyValidationSessionRange {
  startSession: string;
  endSession: string;
}

export function selectStrategyCandles(
  rows: Candle[],
  range: StrategyValidationSessionRange
): Candle[] {
  return rows.filter((row) => {
    const session = row.date.toISOString().slice(0, 10);
    return session >= range.startSession && session <= range.endSession;
  });
}

export interface StrategyValidationDependencies {
  loadConfig?: typeof loadPipelineConfig;
  universe?: Readonly<Record<string, string>>;
  evaluate?: (
    ticker: string,
    prices: Candle[],
    spy: Candle[],
    sector: Candle[],
    config: PipelineConfig
  ) => Promise<BacktestSignal[]>;
  onProgress?: (progress: { completed: number; total: number; unavailable: number }) => void;
}

async function sourceHashes() {
  const entries = await Promise.all(
    SOURCE_FILES.map(async (file) => ({
      file,
      sha256: createHash('sha256')
        .update(await readFile(path.join(PROJECT_ROOT, file)))
        .digest('hex'),
    }))
  );
  return { files: entries, sha256: createHash('sha256').update(stableJson(entries)).digest('hex') };
}

async function evaluateWorkers(
  tickers: string[],
  snapshotDirectory: string,
  universe: Record<string, string>,
  config: PipelineConfig,
  sessionRange: StrategyValidationSessionRange,
  count: number,
  onResult: (ticker: string, signals: BacktestSignal[] | null) => void
) {
  let cursor = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(count, tickers.length) },
      () =>
        new Promise<void>((resolve, reject) => {
          const worker = new Worker(new URL('./strategy-validation-worker.ts', import.meta.url), {
            workerData: { snapshotDirectory, universe, config, sessionRange },
          });
          let ticker: string | undefined;
          let done = false;
          const next = () => {
            if (cursor < tickers.length) {
              ticker = tickers[cursor++];
              worker.postMessage({ ticker });
            } else {
              ticker = undefined;
              done = true;
              worker.postMessage({ done: true });
            }
          };
          worker.on(
            'message',
            (message: {
              ready?: boolean;
              ticker?: string;
              signals?: Array<Omit<BacktestSignal, 'date'> & { date: string }>;
              failed?: boolean;
            }) => {
              if (message.ready) {
                next();
                return;
              }
              if (message.ticker !== ticker || !ticker) {
                void worker.terminate();
                reject(new Error('Unexpected measurement worker response'));
                return;
              }
              onResult(
                ticker,
                message.failed
                  ? null
                  : (message.signals ?? []).map((signal) => ({
                      ...signal,
                      date: new Date(signal.date),
                    }))
              );
              next();
            }
          );
          worker.on('error', reject);
          worker.on('exit', (code) =>
            done && code === 0 ? resolve() : reject(new Error('Measurement worker stopped'))
          );
        })
    )
  );
}

export async function validateStrategyDataset(
  options: StrategyValidationOptions,
  dependencies: StrategyValidationDependencies = {}
) {
  const workers = options.workers ?? Math.min(6, Math.max(1, availableParallelism() - 1));
  if (!Number.isInteger(workers) || workers < 1 || workers > 6)
    throw new TypeError('workers must be 1–6');
  const datasetDirectory = await realpath(options.datasetDirectory);
  const generatedAt = new Date().toISOString();
  const id = `${generatedAt.replace(/[:.]/g, '-')}-${randomUUID()}`;
  const outputFile = path.resolve(
    options.outputFile ?? path.join(PROJECT_ROOT, 'data/strategy-validation', `${id}.json`)
  );
  if (outputFile === datasetDirectory || outputFile.startsWith(`${datasetDirectory}${path.sep}`))
    throw new TypeError('Output cannot alter the source dataset');
  const snapshotDirectory = path.join(
    path.dirname(outputFile),
    `${path.basename(outputFile, path.extname(outputFile))}-inputs`
  );
  await mkdir(snapshotDirectory, { recursive: false, mode: 0o700 }).catch(
    async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(path.dirname(snapshotDirectory), { recursive: true, mode: 0o700 });
      await mkdir(snapshotDirectory, { mode: 0o700 });
    }
  );
  const universe = { ...(dependencies.universe ?? TICKER_SECTOR_ETF) };
  const tickers = [...new Set(options.tickers ?? Object.keys(universe))].sort();
  if (
    !tickers.length ||
    tickers.some(
      (ticker) => !Object.hasOwn(universe, ticker) || !/^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(ticker)
    )
  )
    throw new TypeError('Tickers must come from the frozen configured universe');
  const config = freezeConfig(
    await (dependencies.loadConfig ?? loadPipelineConfig)({ configPath: options.configPath })
  );
  const configSha256 = strategyConfigFingerprint(config);
  const source = await sourceHashes();
  const rangeRaw = await readFile(path.join(datasetDirectory, 'range.json'));
  const range = JSON.parse(rangeRaw.toString('utf8')) as { start: string; end: string };
  if (
    !Number.isFinite(Date.parse(range.start)) ||
    !Number.isFinite(Date.parse(range.end)) ||
    Date.parse(range.start) >= Date.parse(range.end) ||
    Date.parse(range.end) > Date.parse(generatedAt)
  )
    throw new TypeError('A frozen requested history range is required');
  const now = new Date(generatedAt);
  const previousUtcDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 1
  )
    .toISOString()
    .slice(0, 10);
  const requestedEndSession = new Date(range.end).toISOString().slice(0, 10);
  const sessionRange = {
    startSession: new Date(range.start).toISOString().slice(0, 10),
    endSession: requestedEndSession < previousUtcDay ? requestedEndSession : previousUtcDay,
  };
  await writeFile(path.join(snapshotDirectory, 'range.json'), rangeRaw, {
    flag: 'wx',
    mode: 0o600,
  });
  const symbols = [
    ...new Set(['SPY', ...tickers, ...tickers.map((ticker) => universe[ticker])]),
  ].sort();
  const data = new Map<string, Candle[]>();
  const inputs: Array<{
    symbol: string;
    sha256: string;
    sourceSessions: number;
    excludedSessions: number;
    sessions: number;
    firstSession: string | null;
    lastSession: string | null;
  }> = [];
  const inputFailures = new Map<string, string>();
  for (const symbol of symbols) {
    try {
      const raw = await readFile(path.join(datasetDirectory, `${symbol}.json`));
      const sourceRows = parseStrategyCandles(JSON.parse(raw.toString('utf8')));
      const rows = selectStrategyCandles(sourceRows, sessionRange);
      await writeFile(path.join(snapshotDirectory, `${symbol}.json`), raw, {
        flag: 'wx',
        mode: 0o600,
      });
      data.set(symbol, rows);
      inputs.push({
        symbol,
        sha256: createHash('sha256').update(raw).digest('hex'),
        sourceSessions: sourceRows.length,
        excludedSessions: sourceRows.length - rows.length,
        sessions: rows.length,
        firstSession: rows[0]?.date.toISOString() ?? null,
        lastSession: rows.at(-1)?.date.toISOString() ?? null,
      });
    } catch (error) {
      inputFailures.set(
        symbol,
        (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing-input' : 'invalid-input'
      );
    }
  }
  const failures: Array<{ ticker: string; reason: string }> = [];
  const eligible = tickers.filter((ticker) => {
    const reason =
      inputFailures.get(ticker) ??
      ((data.get(ticker)?.length ?? 0) < 210 ? 'insufficient-history' : null) ??
      ((data.get('SPY')?.length ?? 0) < 210 ? 'spy-unavailable' : null) ??
      ((data.get(universe[ticker])?.length ?? 0) < 210 ? 'sector-unavailable' : null);
    if (reason) failures.push({ ticker, reason });
    return !reason;
  });
  const frozen = {
    schemaVersion: 1,
    frozenAt: generatedAt,
    strategyId: CANONICAL_STRATEGY_ID,
    pipelineConfigVersion: PIPELINE_CONFIG_VERSION,
    config,
    configSha256,
    universe: Object.fromEntries(tickers.map((ticker) => [ticker, universe[ticker]])),
    requestedRange: range,
    appliedSessionRange: {
      ...sessionRange,
      boundaryPolicy:
        'Requested UTC session-date bounds; conservatively exclude the current UTC day; first 205 candles are indicator warmup',
    },
    source,
    inputs,
    failures,
    execution: {
      entry: 'next-session open',
      exit: 'fifth session close including entry',
      roundTripCostPct: DEFAULT_ROUND_TRIP_COST_PCT,
      wins: 'net return > 0',
    },
  };
  await writeMarketScreenJson(path.join(snapshotDirectory, 'manifest.json'), frozen);
  const allSignals: BacktestSignal[] = [];
  const prices = new Map<string, Candle[]>();
  let completed = 0;
  const onResult = (ticker: string, signals: BacktestSignal[] | null) => {
    completed++;
    if (signals === null) failures.push({ ticker, reason: 'evaluation-failed' });
    else {
      prices.set(ticker, data.get(ticker)!);
      allSignals.push(...signals);
    }
    dependencies.onProgress?.({ completed, total: eligible.length, unavailable: failures.length });
  };
  if (dependencies.evaluate) {
    for (const ticker of eligible) {
      try {
        onResult(
          ticker,
          await dependencies.evaluate(
            ticker,
            data.get(ticker)!,
            data.get('SPY')!,
            data.get(universe[ticker])!,
            config
          )
        );
      } catch {
        onResult(ticker, null);
      }
    }
  } else if (workers === 1) {
    for (const ticker of eligible) {
      try {
        const context = buildTickerContext(
          data.get(ticker)!,
          data.get('SPY')!,
          data.get(universe[ticker])!
        );
        onResult(
          ticker,
          context
            ? runSignalsWithContext(context, ticker, config).filter(
                (signal) => signal.decision === 'BUY'
              )
            : null
        );
      } catch {
        onResult(ticker, null);
      }
    }
  } else
    await evaluateWorkers(
      eligible,
      snapshotDirectory,
      universe,
      config,
      sessionRange,
      workers,
      onResult
    );
  const finalSource = await sourceHashes();
  const observedStarts = inputs
    .map((input) => input.firstSession)
    .filter((date): date is string => date !== null)
    .sort();
  const observedEnds = inputs
    .map((input) => input.lastSession)
    .filter((date): date is string => date !== null)
    .sort();
  const measurement = measureStrategyValidation(allSignals, prices, DEFAULT_ROUND_TRIP_COST_PCT, {
    spy: data.get('SPY'),
  });
  const report = {
    ...frozen,
    generatedAt: new Date().toISOString(),
    status:
      source.sha256 !== finalSource.sha256 ? 'invalid' : failures.length ? 'partial' : 'completed',
    requestedTickers: tickers.length,
    evaluatedTickers: prices.size,
    unavailableTickers: failures.length,
    observedInputRange: {
      firstSession: observedStarts[0] ?? null,
      lastSession: observedEnds.at(-1) ?? null,
    },
    inputFingerprint: createHash('sha256')
      .update(stableJson({ inputs, universe: frozen.universe, range: frozen.appliedSessionRange }))
      .digest('hex'),
    sourceVersion: 'Working-tree source hashes; no assertion that HEAD equals the measured code',
    sourceChangedDuringMeasurement: source.sha256 !== finalSource.sha256,
    finalSource,
    independentOutOfSample: false,
    limitations: [
      'The present selected universe has survivorship and selection bias.',
      'The cached period, including 2025 onward, was previously observed; this is descriptive re-evaluation, not independent out-of-sample evidence.',
      'BUY observations can overlap. Non-overlapping execution permits at most one long position per ticker.',
      'Live and historical analysis replay consumed setups through the same causal helper. Cluster gaps use calendar days; parity requires the same available history and benchmarks.',
      'Live histories shorter than 210 candles use a fallback that is not validated by this historical engine.',
      'Historical point-in-time earnings and analyst estimate revisions are unavailable.',
      'Fixed five-session exits do not simulate ATR stop/target exits or future execution probabilities.',
      'Annual groups use entry-session cohorts; pre-2025 split purges trades whose exits cross the boundary.',
      'The account simulation follows executed trades with K equal cash slots and marks them at session closes; it is a capital-constrained replay, not a trading record.',
      'Matched SPY windows and the bootstrap interval treat trades as independent; same-day entries share one market window.',
    ],
    selection: {
      trialsEvaluated: 1,
      note: 'One frozen configuration was measured; no parameter search ran. The shipped gate was chosen earlier from a 544,320-config filter grid ranked by train win rate, so in-sample numbers cannot establish an edge.',
    },
    failures,
    tickerCoverage: [...prices].map(([ticker, rows]) => ({
      ticker,
      sessions: rows.length,
      firstSession: rows[0].date.toISOString(),
      lastSession: rows.at(-1)!.date.toISOString(),
    })),
    ...measurement,
  };
  await writeMarketScreenJson(outputFile, report);
  return { report, outputFile, snapshotDirectory };
}
