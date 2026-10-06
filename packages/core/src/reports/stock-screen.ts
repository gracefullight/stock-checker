import { DEFAULT_SCREENER_TICKERS } from '@/constants/screener';
import { gateReasons } from '@/reports/signal-reasons';
import type { LongRiskLevels } from '@/services/risk-levels';
import type {
  analyzeTickerContext,
  TickerAnalysisContext,
  TickerAnalysisUnavailable,
} from '@/services/ticker-analysis';
import type { PipelineConfig, PipelineResult } from '@/types';
import { loadPipelineConfig } from '@/utils/config-loader';
import {
  describeAnalysisUnavailable,
  type ScreenAnalysisUnavailable,
} from '@/utils/screening-diagnostics';

type SignalDecision = PipelineResult['finalDecision'];

export interface StockScreenOptions {
  tickers?: string[];
  decision?: SignalDecision | 'ALL';
  lookbackDays?: number;
  limit?: number;
}

export interface StockScreenDependencies {
  analyzeTickerContext?: typeof analyzeTickerContext;
  /** Offline configuration injection; public screening inputs do not accept paths. */
  loadPipelineConfig?: typeof loadPipelineConfig;
  /** Tests may shorten the deadline; production scans have a 45-second budget. */
  timeBudgetMs?: number;
}

export interface StockScreenMatch {
  ticker: string;
  dataAsOf: string | null;
  decision: SignalDecision;
  score: number;
  buyScore: number;
  sellScore: number;
  gates: PipelineResult['gateResults'];
  gateReasons: string[];
  execution: {
    entry: {
      status: 'conditional';
      timing: 'next-session-open';
      price: null;
      eligible: boolean;
    };
    reference:
      | (LongRiskLevels & {
          basis: 'latest-completed-close';
          price: number;
          atr: number;
        })
      | null;
  };
  rsi: number | null;
  sector: string | null;
}

export interface StockScreenResult {
  schemaVersion: 1;
  generatedAt: string;
  status: 'available' | 'partial' | 'unavailable';
  universe: {
    source: 'default-screener' | 'provided';
    tickers: string[];
  };
  criteria: {
    decision: SignalDecision | 'ALL';
    lookbackDays: number;
    limit: number;
    timeBudgetMs: number;
    engine: string;
    pipelineConfig: PipelineConfig;
    sort: {
      metric: 'buyScore' | 'sellScore';
      order: 'descending';
      tieBreaker: 'ticker-ascending';
    };
  };
  coverage: {
    requested: number;
    analyzed: number;
    unavailable: number;
    matched: number;
    returned: number;
    truncated: boolean;
  };
  decisionCounts: Record<SignalDecision, number>;
  matches: StockScreenMatch[];
  excluded: Array<{
    ticker: string;
    decision: SignalDecision;
    score: number;
    buyScore: number;
    sellScore: number;
    gateReasons: string[];
  }>;
  unavailable: ScreenAnalysisUnavailable[];
  warnings: string[];
}

interface ValidatedOptions {
  tickers: string[];
  source: StockScreenResult['universe']['source'];
  decision: StockScreenResult['criteria']['decision'];
  lookbackDays: number;
  limit: number;
}

function validateOptions(options: StockScreenOptions): ValidatedOptions {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('screen options must be an object');
  }
  const input = options.tickers === undefined ? [...DEFAULT_SCREENER_TICKERS] : options.tickers;
  if (!Array.isArray(input) || input.length < 1 || input.length > 50) {
    throw new TypeError('tickers must contain from 1 to 50 symbols');
  }
  const tickers = input.map((ticker) => {
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
  const decision = options.decision === undefined ? 'BUY' : options.decision;
  if (!['BUY', 'SELL', 'HOLD', 'ALL'].includes(decision)) {
    throw new TypeError('decision must be BUY, SELL, HOLD, or ALL');
  }
  const lookbackDays = options.lookbackDays === undefined ? 730 : options.lookbackDays;
  if (!Number.isInteger(lookbackDays) || lookbackDays < 730 || lookbackDays > 3650) {
    throw new TypeError('lookbackDays must be an integer from 730 to 3650');
  }
  const limit = options.limit === undefined ? 20 : options.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new TypeError('limit must be an integer from 1 to 50');
  }
  return {
    tickers: [...new Set(tickers)],
    source: options.tickers === undefined ? 'default-screener' : 'provided',
    decision,
    lookbackDays,
    limit,
  };
}

function sessionDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value &&
    value <= new Date().toISOString().slice(0, 10)
    ? value
    : null;
}

export function projectMatch(ticker: string, context: TickerAnalysisContext): StockScreenMatch {
  const { result, pipelineResult: signal } = context;
  if (
    !['BUY', 'SELL', 'HOLD'].includes(signal.finalDecision) ||
    ![signal.score, signal.buyScore, signal.sellScore].every(Number.isFinite)
  ) {
    throw new Error('Invalid engine result');
  }
  const levels = [
    result.close,
    result.atr,
    result.stopLoss,
    result.takeProfit,
    result.trailingStop,
    result.trailingStart,
  ];
  const validLevels = levels.every((level) => Number.isFinite(level) && level > 0);
  return {
    ticker,
    dataAsOf: sessionDate(result.date),
    decision: signal.finalDecision,
    score: signal.score,
    buyScore: signal.buyScore,
    sellScore: signal.sellScore,
    gates: signal.gateResults,
    gateReasons: gateReasons(context),
    execution: {
      entry: {
        status: 'conditional',
        timing: 'next-session-open',
        price: null,
        eligible: signal.finalDecision === 'BUY',
      },
      reference: validLevels
        ? {
            basis: 'latest-completed-close',
            price: result.close,
            atr: result.atr,
            stopLoss: result.stopLoss,
            takeProfit: result.takeProfit,
            trailingStop: result.trailingStop,
            trailingStart: result.trailingStart,
          }
        : null,
    },
    rsi: Number.isFinite(result.rsi) && result.rsi >= 0 && result.rsi <= 100 ? result.rsi : null,
    sector: result.sector ?? null,
  };
}

async function defaultAnalyzer(...args: Parameters<typeof analyzeTickerContext>) {
  const engine = await import('@/services/ticker-analysis');
  return engine.analyzeTickerContext(...args);
}

const numeric = (value: number | undefined): string =>
  value === undefined ? 'N/A' : value.toFixed(2);
const escapeMarkdown = (value: string): string => value.replace(/[\\`*_{}[\]()#+.!|<>-]/g, '\\$&');

export function renderStockScreenMarkdown(screen: StockScreenResult): string {
  const lines = [
    '# Stock signal screen',
    '',
    `Generated: ${screen.generatedAt}; status: ${screen.status}.`,
    `Filter: ${screen.criteria.decision}; lookback ${screen.criteria.lookbackDays} calendar days; result limit ${screen.criteria.limit}; time budget ${screen.criteria.timeBudgetMs} ms.`,
    `Universe: ${screen.universe.source}, ${screen.universe.tickers.length} tickers: ${screen.universe.tickers.join(', ')}.`,
    `Coverage: ${screen.coverage.analyzed}/${screen.coverage.requested} analyzed; ${screen.coverage.unavailable} unavailable; ${screen.coverage.matched} matched, ${screen.coverage.returned} returned${screen.coverage.truncated ? ' (truncated by limit)' : ''}.`,
    `Final decisions: BUY ${screen.decisionCounts.BUY}, SELL ${screen.decisionCounts.SELL}, HOLD ${screen.decisionCounts.HOLD}.`,
    `Sort: ${screen.criteria.sort.metric} descending, ticker ascending on ties.`,
    '',
    '## Matching final decisions',
    '',
  ];
  if (screen.matches.length === 0) {
    lines.push(
      screen.status === 'unavailable'
        ? 'No ticker could be analyzed.'
        : `No analyzed ticker has final decision ${screen.criteria.decision}.`
    );
  } else {
    lines.push(
      '| Ticker | Session | Decision | BUY score | SELL score | Close reference | Stop reference | Target reference |',
      '|---|---|---|---:|---:|---:|---:|---:|'
    );
    for (const match of screen.matches) {
      const reference = match.execution.reference;
      lines.push(
        `| ${match.ticker} | ${match.dataAsOf ?? 'N/A'} | ${match.decision} | ${numeric(match.buyScore)} | ${numeric(match.sellScore)} | ${numeric(reference?.price)} | ${numeric(reference?.stopLoss)} | ${numeric(reference?.takeProfit)} |`
      );
    }
    for (const match of screen.matches) {
      lines.push(
        '',
        `### ${match.ticker}`,
        '',
        ...match.gateReasons.map((reason) => `- ${escapeMarkdown(reason)}`)
      );
    }
  }
  if (screen.excluded.length > 0) {
    lines.push('', '## Other analyzed decisions', '');
    for (const excluded of screen.excluded) {
      lines.push(
        `- ${excluded.ticker}: ${excluded.decision}; BUY score ${numeric(excluded.buyScore)}, SELL score ${numeric(excluded.sellScore)}.`,
        ...excluded.gateReasons.map((reason) => `  - ${escapeMarkdown(reason)}`)
      );
    }
  }
  if (screen.unavailable.length > 0) {
    lines.push('', '## Unavailable tickers', '');
    for (const unavailable of screen.unavailable) {
      lines.push(`- ${unavailable.ticker}: ${unavailable.reason}`);
    }
  }
  lines.push('', '## Interpretation', '', ...screen.warnings.map((warning) => `- ${warning}`));
  return lines.join('\n');
}

/** Screen existing final engine decisions; this does not calculate historical outcome rates. */
export async function generateStockScreen(
  options: StockScreenOptions = {},
  dependencies: StockScreenDependencies = {}
): Promise<{ screen: StockScreenResult; markdown: string }> {
  const input = validateOptions(options);
  const timeBudgetMs = dependencies.timeBudgetMs ?? 45_000;
  if (!Number.isInteger(timeBudgetMs) || timeBudgetMs < 1 || timeBudgetMs > 45_000) {
    throw new TypeError('timeBudgetMs must be an integer from 1 to 45000');
  }
  const analyze = dependencies.analyzeTickerContext ?? defaultAnalyzer;
  const pipelineConfig = await (dependencies.loadPipelineConfig ?? loadPipelineConfig)();
  const analyzed: Array<StockScreenMatch | null> = Array(input.tickers.length).fill(null);
  const unavailable: Array<ScreenAnalysisUnavailable | null> = Array(input.tickers.length).fill(
    null
  );
  const states: Array<'queued' | 'running' | 'completed'> = Array(input.tickers.length).fill(
    'queued'
  );
  const deadline = Date.now() + timeBudgetMs;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadlineReached = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve();
    }, timeBudgetMs);
  });
  let nextIndex = 0;
  const workers = Promise.all(
    Array.from({ length: Math.min(2, input.tickers.length) }, async () => {
      while (nextIndex < input.tickers.length) {
        if (expired || Date.now() >= deadline) {
          expired = true;
          return;
        }
        const index = nextIndex++;
        const ticker = input.tickers[index];
        states[index] = 'running';
        let unavailableReason: TickerAnalysisUnavailable | undefined;
        try {
          const context = await analyze(ticker, null, {
            lookbackDays: input.lookbackDays,
            pipelineConfig,
            onUnavailable: (reason) => {
              unavailableReason = reason;
            },
          });
          if (expired || Date.now() >= deadline) {
            expired = true;
            return;
          }
          if (context) analyzed[index] = projectMatch(ticker, context);
          else
            unavailable[index] = {
              ticker,
              reason: unavailableReason
                ? describeAnalysisUnavailable(unavailableReason)
                : 'No usable completed-session analysis is available.',
              ...(unavailableReason ? { diagnostics: unavailableReason } : {}),
            };
        } catch {
          if (expired || Date.now() >= deadline) {
            expired = true;
            return;
          }
          unavailable[index] = {
            ticker,
            reason: 'Analysis could not be completed for this ticker.',
          };
        }
        states[index] = 'completed';
      }
    })
  );
  try {
    // Race the whole scan once. Per-ticker races would free worker slots while
    // old provider requests still run and exceed the two-request limit.
    await Promise.race([workers, deadlineReached]);
  } finally {
    clearTimeout(timer);
  }
  if (expired) {
    for (let index = 0; index < input.tickers.length; index++) {
      if (states[index] !== 'completed') {
        unavailable[index] = {
          ticker: input.tickers[index],
          reason:
            states[index] === 'running'
              ? 'Screen time budget exhausted while ticker analysis was in progress.'
              : 'Screen time budget exhausted before ticker analysis started.',
        };
      }
    }
  }
  const successful = analyzed.filter((match): match is StockScreenMatch => match !== null);
  const failures = unavailable.filter(
    (failure): failure is ScreenAnalysisUnavailable => failure !== null
  );
  const decisionCounts: Record<SignalDecision, number> = { BUY: 0, SELL: 0, HOLD: 0 };
  for (const match of successful) decisionCounts[match.decision]++;
  const metric = input.decision === 'SELL' ? 'sellScore' : 'buyScore';
  const matched = successful
    .filter((match) => input.decision === 'ALL' || match.decision === input.decision)
    .sort((left, right) => right[metric] - left[metric] || left.ticker.localeCompare(right.ticker));
  const matches = matched.slice(0, input.limit);
  const screen: StockScreenResult = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: successful.length === 0 ? 'unavailable' : failures.length > 0 ? 'partial' : 'available',
    universe: { source: input.source, tickers: input.tickers },
    criteria: {
      decision: input.decision,
      lookbackDays: input.lookbackDays,
      limit: input.limit,
      timeBudgetMs,
      engine: 'Shared leader-pullback pipeline with one resolved configuration per scan',
      pipelineConfig,
      sort: { metric, order: 'descending', tieBreaker: 'ticker-ascending' },
    },
    coverage: {
      requested: input.tickers.length,
      analyzed: successful.length,
      unavailable: failures.length,
      matched: matched.length,
      returned: matches.length,
      truncated: matched.length > matches.length,
    },
    decisionCounts,
    matches,
    excluded: successful
      .filter((match) => input.decision !== 'ALL' && match.decision !== input.decision)
      .map(({ ticker, decision, score, buyScore, sellScore, gateReasons: reasons }) => ({
        ticker,
        decision,
        score,
        buyScore,
        sellScore,
        gateReasons: reasons,
      })),
    unavailable: failures,
    warnings: [
      input.source === 'default-screener'
        ? 'The default universe is the web screener’s selected 20 tickers, not the entire market.'
        : 'This screen covers only the provided tickers, not the entire market.',
      'Only the existing engine final decision determines a match; a high BUY score can remain HOLD when gates block entry.',
      'BUY and SELL scores are signal strengths, not probabilities of profit.',
      'Entry remains conditional on the next session open; the future fill price is unknown. Risk levels based on average daily price range use the latest completed close and require recalculation from the actual fill.',
      'SELL is a long-holder exit warning, not a short-entry recommendation.',
      'Historical win rates, stop-touch rates, analyst targets and peer valuation are not computed by this screen. Use analyze_stock for a detailed ticker report.',
      'Snapshots use current metadata and may have different completed-session dates; inspect each ticker’s dataAsOf and availability.',
      'Eligible histories replay the same prior BUY/quality-blocked cluster state as backtests; repeated snapshots from the same completed session are not independent new trade opportunities.',
    ],
  };
  if (expired) {
    screen.warnings.push(
      `The ${timeBudgetMs} ms screen time budget expired; unfinished tickers are unavailable. Up to two in-progress provider calls may finish after this response; no further tickers will start.`
    );
  }
  if (matches.some((match) => match.execution.reference === null)) {
    screen.warnings.push('Some matching tickers have unavailable completed-close risk references.');
  }
  return { screen, markdown: renderStockScreenMarkdown(screen) };
}
