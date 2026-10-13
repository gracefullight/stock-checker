import {
  DAILY_REPORT_DATE_PATTERN,
  type DailyReportReader,
  type DailyReportState,
  readDailyReport,
} from '@mcp/daily-report.ts';
import type { McpServer } from '@modelcontextprotocol/server';
import type {
  createMarketScreenJob,
  getMarketScreenJob,
  getMarketScreenPerformance,
  listMarketScreenJobs,
  MarketScreenJob,
  pauseMarketScreenJob,
  refreshMarketScreenPerformance,
  runMarketScreenJob,
} from '@stock-checker/core/src/reports/market-screen.ts';
import { z } from 'zod/v4';

export interface MarketScreenService {
  create: typeof createMarketScreenJob;
  get: typeof getMarketScreenJob;
  resume: typeof runMarketScreenJob;
  pause: typeof pauseMarketScreenJob;
  getPerformance: typeof getMarketScreenPerformance;
  refreshPerformance: typeof refreshMarketScreenPerformance;
  /** Optional read-only readers; tools report an actionable error when absent. */
  list?: typeof listMarketScreenJobs;
  dailyReport?: DailyReportReader;
}

const FINVIZ_PARAMETERS = new Set(['v', 'f', 'ft', 'o', 'r', 't', 's', 'c', 'ar', 'p', 'ta']);
const FILTER_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
const tickerInput = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^\^?[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*(?:=[A-Za-z0-9]+)?$/);
const jobIdInput = z.string().uuid().describe('The UUID returned by create_market_screen.');
const formatInput = z
  .enum(['detailed', 'compact'])
  .describe(
    'detailed renders a table plus every gate reason per ticker; compact renders one line per ticker with the first blocking reason to save tokens.'
  );

export function isFinvizScreenSource(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'finviz.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      ['/screener', '/screener.ashx'].includes(url.pathname) &&
      [...url.searchParams].every(
        ([key, parameter]) => FINVIZ_PARAMETERS.has(key) && /^[A-Za-z0-9_,.+=^-]*$/.test(parameter)
      ) &&
      [...url.searchParams.keys()].every((key, index, keys) => keys.indexOf(key) === index)
    );
  } catch {
    return false;
  }
}

export const createMarketScreenInput = z
  .strictObject({
    tickers: z
      .array(tickerInput)
      .min(1)
      .max(15000)
      .describe('Collected Finviz ticker rows, at most 15000 entries before deduplication.'),
    provenance: z.strictObject({
      source: z.literal('Finviz'),
      url: z
        .string()
        .trim()
        .max(4096)
        .refine(
          isFinvizScreenSource,
          'Use a public HTTPS Finviz screener URL without credentials or secret parameters.'
        )
        .describe('Descriptive source URL only. The server does not fetch or scrape this URL.'),
      filters: z
        .array(z.string().min(1).max(160).regex(FILTER_PATTERN))
        .max(100)
        .describe(
          'Exact ordered filter identifiers from the source URL f parameter; use [] for no filters.'
        ),
      sourceTotal: z
        .number()
        .int()
        .min(1)
        .max(Number.MAX_SAFE_INTEGER)
        .describe('Finviz-reported total after these filters, not the entire exchange population.'),
      overallTotal: z
        .number()
        .int()
        .min(1)
        .max(Number.MAX_SAFE_INTEGER)
        .optional()
        .describe('Optional Finviz-reported unfiltered total, distinct from filtered sourceTotal.'),
      capturedAt: z.iso
        .datetime({ offset: true })
        .describe('Timestamp when the browser/CSV candidate list was collected.'),
      pages: z
        .number()
        .int()
        .min(1)
        .max(15000)
        .optional()
        .describe('Number of browser/CSV pages collected, when known.'),
      completeness: z
        .enum(['complete', 'partial'])
        .describe(
          'Caller-declared collection completeness; complete also requires unique ticker count = sourceTotal.'
        ),
    }),
    decision: z.enum(['BUY', 'SELL', 'HOLD', 'ALL']).default('BUY'),
    lookbackDays: z.number().int().min(730).max(3650).default(730),
    autoStart: z
      .boolean()
      .default(true)
      .describe(
        'Start analysis immediately; false saves a paused manifest without market-data requests.'
      ),
  })
  .superRefine(({ tickers, provenance }, context) => {
    const collected = new Set(tickers.map((ticker) => ticker.toUpperCase())).size;
    if (
      collected > provenance.sourceTotal ||
      (provenance.completeness === 'complete' && collected !== provenance.sourceTotal)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['provenance', 'completeness'],
        message:
          'Collected unique ticker count must fit sourceTotal; complete requires equal counts.',
      });
    }
    if (provenance.overallTotal !== undefined && provenance.overallTotal < provenance.sourceTotal) {
      context.addIssue({
        code: 'custom',
        path: ['provenance', 'overallTotal'],
        message: 'overallTotal must not be smaller than the filtered sourceTotal.',
      });
    }
    try {
      const filters =
        new URL(provenance.url).searchParams.get('f')?.split(',').filter(Boolean) ?? [];
      if (JSON.stringify(filters) !== JSON.stringify(provenance.filters)) {
        context.addIssue({
          code: 'custom',
          path: ['provenance', 'filters'],
          message: 'Preserve the exact ordered filters from the source URL f parameter.',
        });
      }
    } catch {
      /* URL validation supplies the safe error message. */
    }
  });

export const getMarketScreenInput = z.strictObject({
  jobId: jobIdInput,
  kind: z.enum(['matches', 'excluded', 'unavailable']).default('matches'),
  offset: z.number().int().min(0).max(15000).default(0),
  limit: z.number().int().min(1).max(100).default(20),
  format: formatInput.default('detailed'),
});

export const listMarketScreensInput = z.strictObject({
  offset: z.number().int().min(0).max(15000).default(0),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('Maximum saved jobs to list, newest first; default 10, maximum 50.'),
});

export const getDailyReportInput = z.strictObject({
  date: z
    .string()
    .regex(DAILY_REPORT_DATE_PATTERN)
    .optional()
    .describe(
      'Australia/Sydney local date (YYYY-MM-DD) of the 09:00 daily run; omit for the latest saved run.'
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('Maximum matched rows, and near-miss rows on zero-match days; default 10.'),
  format: formatInput.default('compact'),
});

export const controlMarketScreenInput = z.strictObject({
  jobId: jobIdInput,
  action: z.enum(['resume', 'pause']),
});

export const getMarketScreenPerformanceInput = z.strictObject({
  jobId: jobIdInput,
  offset: z.number().int().min(0).max(15000).default(0),
  limit: z.number().int().min(1).max(100).default(20),
});

export const refreshMarketScreenPerformanceInput = z.strictObject({
  jobId: jobIdInput,
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe('Maximum recommendation observations to refresh explicitly; default 20, maximum 50.'),
});

const defaultService: MarketScreenService = {
  async create(...args) {
    const core = await import('@stock-checker/core/src/reports/market-screen.ts');
    return core.createMarketScreenJob(...args);
  },
  async get(...args) {
    const core = await import('@stock-checker/core/src/reports/market-screen.ts');
    return core.getMarketScreenJob(...args);
  },
  async resume(...args) {
    const core = await import('@stock-checker/core/src/reports/market-screen.ts');
    return core.runMarketScreenJob(...args);
  },
  async pause(...args) {
    const core = await import('@stock-checker/core/src/reports/market-screen.ts');
    return core.pauseMarketScreenJob(...args);
  },
  async getPerformance(...args) {
    const core = await import('@stock-checker/core/src/reports/market-screen.ts');
    return core.getMarketScreenPerformance(...args);
  },
  async refreshPerformance(...args) {
    const core = await import('@stock-checker/core/src/reports/market-screen.ts');
    return core.refreshMarketScreenPerformance(...args);
  },
  async list(...args) {
    const core = await import('@stock-checker/core/src/reports/market-screen.ts');
    return core.listMarketScreenJobs(...args);
  },
  dailyReport: readDailyReport,
};

type MarketScreenSnapshot = Awaited<ReturnType<MarketScreenService['get']>>;
type MarketScreenPerformanceSnapshot = Awaited<ReturnType<MarketScreenService['getPerformance']>>;
type MarketScreenPage = MarketScreenSnapshot['page'];
type ResultFormat = z.infer<typeof formatInput>;

const escapeMarkdown = (value: string): string => value.replace(/[\\`*_{}[\]()#+.!|<>-]/g, '\\$&');
const numeric = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : 'N/A');
/** US exchange session date (America/New_York) of a timestamp; sessions per ticker may differ. */
const usSessionDate = (timestamp: string): string => {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed)
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(parsed)
    : 'N/A';
};

/** Optional job labels another core change may add; absent fields fall back safely. */
function jobOrigin(job: MarketScreenJob, dailyJobId: string | null): string {
  const labelled = job as MarketScreenJob & { origin?: unknown; label?: unknown };
  if (typeof labelled.origin === 'string' && labelled.origin) return labelled.origin;
  if (dailyJobId && job.id === dailyJobId) return 'daily-report';
  return 'manual';
}

function renderPageRows(page: MarketScreenPage, format: ResultFormat): string[] {
  const lines: string[] = [];
  if (page.kind === 'unavailable') {
    for (const item of page.items) {
      if ('reason' in item)
        lines.push(`- ${escapeMarkdown(item.ticker)}: ${escapeMarkdown(item.reason)}`);
    }
    return lines;
  }
  if (format === 'compact') {
    for (const item of page.items) {
      if (!('decision' in item)) continue;
      const reason = item.gateReasons[0];
      lines.push(
        `- ${escapeMarkdown(item.ticker)} · ${item.decision} · session ${item.dataAsOf ?? 'N/A'} · buy ${numeric(item.buyScore)} · sell ${numeric(item.sellScore)}${reason ? ` · ${escapeMarkdown(reason)}` : ''}`
      );
    }
    return lines;
  }
  lines.push(
    '| Ticker | Session | Final decision | BUY score | SELL score |',
    '|---|---|---|---:|---:|'
  );
  for (const item of page.items) {
    if (!('decision' in item)) continue;
    lines.push(
      `| ${escapeMarkdown(item.ticker)} | ${item.dataAsOf ?? 'N/A'} | ${item.decision} | ${numeric(item.buyScore)} | ${numeric(item.sellScore)} |`
    );
  }
  for (const item of page.items) {
    if (!('decision' in item)) continue;
    lines.push(
      '',
      `### ${escapeMarkdown(item.ticker)}`,
      ...item.gateReasons.map((reason) => `- ${escapeMarkdown(reason)}`)
    );
  }
  return lines;
}

function renderSnapshot(snapshot: MarketScreenSnapshot, format: ResultFormat = 'detailed'): string {
  const { job, page } = snapshot;
  const universe = job.universe;
  const lines = [
    `# Finviz candidate screen — ${job.id}`,
    '',
    `Job status: ${job.status}. Filter: ${job.criteria.decision}; lookback: ${job.criteria.lookbackDays} calendar days.`,
    `Source collection: ${universe.collectedCount}/${universe.sourceTotal} unique filtered candidates; caller-declared ${universe.completeness}. This count comparison does not independently verify Finviz coverage.`,
    `Source filters: ${universe.filters.join(', ') || 'none'}. Captured: ${universe.capturedAt}.`,
    `[Finviz source filters](<${universe.url}>)${universe.overallTotal === null ? '' : `; reported unfiltered total: ${universe.overallTotal}.`}`,
    `Progress: ${job.progress.analyzed}/${job.progress.total} analyzed; ${job.progress.unavailable} unavailable; ${job.progress.pending} pending; ${job.progress.inFlight} in flight; ${job.progress.matched} matched.`,
    `Result page: ${page.kind}, offset ${page.offset}, limit ${page.limit}; ${page.total} total rows${page.hasMore ? '; more pages available' : ''}${format === 'compact' ? '; compact format (first blocking reason only)' : ''}.`,
    ...(job.pauseReason ? [`Pause reason: ${job.pauseReason}`] : []),
    '',
    'The Finviz filtered candidate list is separate from Stock Checker’s final engine decisions. Scores are not win probabilities. Use get_market_screen to read progress and further result pages. Pass the same lookbackDays when inspecting a candidate with analyze_stock or show_stock_dashboard.',
  ];
  if (page.items.length) {
    lines.push('', '## Result page', '', ...renderPageRows(page, format));
  } else {
    lines.push(
      '',
      job.progress.pending || job.progress.inFlight
        ? 'No rows on this page yet; candidate analysis is still incomplete.'
        : 'No rows on this result page.'
    );
  }
  if (job.warnings.length)
    lines.push(
      '',
      '## Interpretation',
      '',
      ...job.warnings.map((warning) => `- ${escapeMarkdown(warning)}`)
    );
  return lines.join('\n');
}

function snapshotResult(snapshot: MarketScreenSnapshot, format: ResultFormat = 'detailed') {
  return {
    content: [{ type: 'text' as const, text: renderSnapshot(snapshot, format) }],
    structuredContent: { ...snapshot },
    isError: false,
  };
}

type JobList = Awaited<ReturnType<typeof listMarketScreenJobs>>;

function renderJobList(list: JobList, dailyJobId: string | null): string {
  const lines = [
    '# Saved market-screen jobs',
    '',
    `${list.total} saved jobs, newest first; showing offset ${list.offset}, limit ${list.limit}${list.hasMore ? '; more pages available' : ''}. Reading this list starts no analysis.`,
    'Created date is the US exchange session date (America/New_York) of job creation; per-ticker session dates inside a job may differ. Status completed/partial describes the supplied candidate list, not whole-market coverage.',
    '',
  ];
  if (!list.jobs.length) {
    lines.push(
      'No saved jobs on this page. Create one with prepare_finviz_screen and create_market_screen, or run the daily report.'
    );
    return lines.join('\n');
  }
  for (const job of list.jobs) {
    const progress = job.progress;
    lines.push(
      `- ${job.id} · origin ${jobOrigin(job, dailyJobId)} · source ${job.universe.source} · ${job.status} · ${job.criteria.decision} filter · ${progress.matched} matched / ${progress.analyzed} analyzed of ${progress.total} (${progress.unavailable} unavailable, ${progress.pending + progress.inFlight} remaining) · created ${usSessionDate(job.createdAt)} (US session date) · updated ${job.updatedAt}`
    );
  }
  lines.push(
    '',
    'Use get_market_screen with a job id for results; get_daily_report opens the latest 09:00 run directly.'
  );
  return lines.join('\n');
}

function renderDailyReport(
  state: DailyReportState,
  matches: MarketScreenSnapshot | null,
  nearMisses: MarketScreenSnapshot | null,
  format: ResultFormat
): string {
  const lines = [
    `# Daily report — ${state.localDate} (Australia/Sydney)`,
    '',
    `Run status: ${state.status}${state.reason ? ` (${escapeMarkdown(state.reason)})` : ''}; started ${state.startedAt}; updated ${state.updatedAt}.`,
    `Collection: ${state.collectedCount}${state.sourceTotal === null ? '' : `/${state.sourceTotal}`} Finviz candidates, ${state.completeness ?? 'unknown'} coverage. Analysis: ${state.analyzedCount} analyzed, ${state.matchedCount} BUY matched. WhatsApp: ${state.notificationStatus ?? 'not attempted'}.`,
    state.jobId
      ? `Saved job: ${state.jobId} (get_market_screen for further pages; web: /market-screen?job=${state.jobId}).`
      : 'No market-screen job was saved for this run.',
  ];
  if (matches) {
    const job = matches.job;
    lines.push(
      `Job status: ${job.status}; ${job.progress.analyzed}/${job.progress.total} analyzed; ${job.progress.matched} matched; ${job.progress.unavailable} unavailable.`
    );
    lines.push('', `## BUY matches (${matches.page.total})`, '');
    if (matches.page.items.length) lines.push(...renderPageRows(matches.page, format));
    else lines.push('No BUY candidates passed the final engine decision on this run.');
  }
  if (nearMisses) {
    lines.push(
      '',
      `## Nearest misses (${nearMisses.page.total} excluded, top ${nearMisses.page.items.length} by BUY score)`,
      '',
      'Excluded candidates ordered by raw BUY score. These are blocked setups, not weaker BUYs; the first gate reason explains the block.',
      ''
    );
    if (nearMisses.page.items.length) lines.push(...renderPageRows(nearMisses.page, 'compact'));
    else lines.push('No excluded rows were saved.');
  }
  lines.push(
    '',
    'Scores are not win probabilities. A matched BUY is a conditional next-open entry with a fifth-session close exit in the validated rule.'
  );
  return lines.join('\n');
}

function renderPerformance(snapshot: MarketScreenPerformanceSnapshot): string {
  const { jobId, policy, summary, page, refresh } = snapshot;
  const percentage = (value: number | null): string =>
    value !== null && Number.isFinite(value) ? `${value.toFixed(2)}%` : 'N/A';
  const price = (value: number | null): string => (value === null ? 'N/A' : numeric(value));
  const lines = [
    `# Recommendation performance — ${jobId}`,
    '',
    'Forward paper observations after eligible saved US BUY recommendations, not actual fills, trading-account returns, or calibrated success probabilities.',
    `Policy: next session open → fifth session close; ${policy.horizonSessions} sessions; ${policy.costBpsRoundTrip} bps round-trip cost. Adjusted prices come from the same fetched series. Timezone: ${policy.timezone}.`,
    `Updated: ${snapshot.updatedAt ?? 'not refreshed yet'}. Refresh: ${refresh.status}; ${refresh.processed}/${refresh.selected} selected observations processed.`,
    ...(refresh.reason ? [`Refresh note: ${escapeMarkdown(refresh.reason)}`] : []),
    '',
    `Recommendations: ${summary.totalRecommendations}; completed: ${summary.completed}; wins: ${summary.wins}; losses: ${summary.losses}; breakeven: ${summary.breakeven}.`,
    `Pending entry: ${summary.pending}; open observations: ${summary.open}; unavailable: ${summary.unavailable}; ineligible: ${summary.ineligible}; legacy untracked: ${summary.legacyUntracked}.`,
    summary.completed > 0
      ? `Observed positive net-return rate: ${percentage(summary.winRatePct)} (n=${summary.completed} completed); average completed net return: ${percentage(summary.averageNetReturnPct)}.`
      : 'Observed positive net-return rate: N/A (n=0 completed); average completed net return: N/A.',
    'Only completed observations enter the rate and average. Pending, open, unavailable, ineligible, and legacy untracked observations are separate. Overlapping recommendations are not independent trade samples.',
    `Result page: offset ${page.offset}, limit ${page.limit}; ${page.total} total rows${page.hasMore ? '; more pages available' : ''}.`,
  ];
  if (page.items.length) {
    lines.push(
      '',
      '| Ticker | Signal session | Recommended at | Status | Entry session | Entry (USD) | Exit session | Exit (USD) | Net return | Outcome |',
      '|---|---|---|---|---|---:|---|---:|---:|---|'
    );
    for (const row of page.items) {
      lines.push(
        `| ${escapeMarkdown(row.ticker)} | ${row.dataAsOf ?? 'N/A'} | ${row.recommendedAt ?? 'N/A'} | ${row.status} | ${row.entryDate ?? 'N/A'} | ${price(row.entryPrice)} | ${row.exitDate ?? 'N/A'} | ${price(row.exitPrice)} | ${percentage(row.netReturnPct)} | ${row.outcome ?? 'N/A'} |`
      );
    }
    for (const row of page.items)
      if (row.reason)
        lines.push('', `${escapeMarkdown(row.ticker)}: ${escapeMarkdown(row.reason)}`);
  } else {
    lines.push('', 'No saved recommendation observations on this page.');
  }
  lines.push(
    '',
    'get_market_screen_performance reads saved results only. refresh_market_screen_performance explicitly starts a bounded background price refresh; it does not resume screening or place orders.'
  );
  return lines.join('\n');
}

function performanceResult(snapshot: MarketScreenPerformanceSnapshot) {
  return {
    content: [{ type: 'text' as const, text: renderPerformance(snapshot) }],
    structuredContent: { ...snapshot },
    isError: false,
  };
}

/** Error text without provider URLs or local paths; validation messages pass through. */
function safeMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const redacted = message
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s)'"]+/gi, '[url]')
    .replace(/(?:^|\s)(?:\/[\w.@-]+){2,}/g, ' [path]')
    .replace(/\s+/g, ' ')
    .trim();
  return redacted ? redacted.slice(0, 300) : null;
}

/**
 * Turns a core failure into an actionable tool error. Core validation errors are
 * TypeErrors with safe messages; a missing job names the recovery tool.
 */
const failure = (error: unknown, context: string) => {
  const name = error instanceof Error ? error.name : '';
  let text: string;
  if (name === 'MarketScreenJobNotFoundError') {
    text = `${context}: the job was not found. Use list_market_screens to find saved job IDs, or get_daily_report for the latest 09:00 run.`;
  } else if (error instanceof TypeError) {
    text = `${context}: ${safeMessage(error) ?? 'invalid request'}. Fix the arguments and retry.`;
  } else {
    text = `${context}: the job request could not be completed${safeMessage(error) ? ` (${safeMessage(error)})` : ''}. Check the job ID and candidate metadata, then try again.`;
  }
  return { content: [{ type: 'text' as const, text }], isError: true };
};

export function registerMarketScreenTools(
  server: McpServer,
  service: MarketScreenService = defaultService
): void {
  server.registerTool(
    'create_market_screen',
    {
      title: 'Create a durable Finviz candidate screen',
      description:
        'Create a resumable Stock Checker job from up to 15000 Finviz candidate rows collected using a browser or CSV. Preserve source URL, filters, collection timestamp, filtered total and complete/partial declaration. Checks count consistency without independently verifying Finviz coverage. Source URL is metadata only and is never fetched. Defaults to final BUY decisions with 730 days of history; analysis runs with at most two concurrent tickers. autoStart defaults true; false saves a paused manifest without market-data requests. Returns a durable job ID and initial progress promptly. No market orders are placed.',
      inputSchema: createMarketScreenInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        return snapshotResult(
          await service.create({
            ...input,
            tickers: input.tickers.map((ticker) => ticker.toUpperCase()),
          })
        );
      } catch (error) {
        return failure(error, 'create_market_screen');
      }
    }
  );

  server.registerTool(
    'get_market_screen',
    {
      title: 'Read market-screen progress and a result page',
      description:
        'Read a durable market-screen job’s progress, Finviz collection coverage and a bounded page of matched, excluded or unavailable tickers. Defaults to matches offset 0, limit 20; maximum 100 rows. format "compact" prints one line per ticker with the first blocking reason (use it for excluded near-miss pages); "detailed" (default) adds a table and every gate reason. Does not start or resume analysis. Completed job status describes the supplied candidate list, not independently verified whole-market coverage.',
      inputSchema: getMarketScreenInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ jobId, kind, offset, limit, format }) => {
      try {
        return snapshotResult(await service.get(jobId, { kind, offset, limit }), format);
      } catch (error) {
        return failure(error, 'get_market_screen');
      }
    }
  );

  server.registerTool(
    'control_market_screen',
    {
      title: 'Resume or pause a market-screen job',
      description:
        'Resume a durable candidate-screen job or request a pause. Pause stops new ticker launches; existing requests may finish and checkpoint. Resume reuses the job and respects its running-owner lock. Returns current progress promptly without waiting for the full scan.',
      inputSchema: controlMarketScreenInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ jobId, action }) => {
      try {
        return snapshotResult(
          await (action === 'resume' ? service.resume(jobId) : service.pause(jobId))
        );
      } catch (error) {
        return failure(error, 'control_market_screen');
      }
    }
  );

  server.registerTool(
    'get_market_screen_performance',
    {
      title: 'Read saved recommendation paper performance',
      description:
        'Read saved forward paper observations after eligible US BUY recommendations: next session open to fifth-session close, with 10 bps round-trip cost. Returns completed sample counts and observed net-return rates separately from pending, open, unavailable, ineligible, and legacy untracked observations. A zero completed sample has no percentage. Defaults to offset 0 and limit 20, maximum 100 rows. Reads saved data only; never requests market prices, resumes screening, or places orders. Observations are not actual fills or calibrated win probabilities.',
      inputSchema: getMarketScreenPerformanceInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ jobId, offset, limit }) => {
      try {
        return performanceResult(
          await service.getPerformance(jobId.toLowerCase(), { offset, limit })
        );
      } catch (error) {
        return failure(error, 'get_market_screen_performance');
      }
    }
  );

  server.registerTool(
    'refresh_market_screen_performance',
    {
      title: 'Refresh a bounded set of recommendation observations',
      description:
        'Explicitly start a bounded background price refresh for eligible saved US BUY recommendation paper observations. Default 20, maximum 50 observations per request; respects the core refresh lock and returns progress promptly. Poll get_market_screen_performance to read saved updates. This updates local performance state and requests market data, but does not resume screening or place orders. Five-session paper outcomes are separate from actual trading fills and calibrated success probabilities.',
      inputSchema: refreshMarketScreenPerformanceInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ jobId, limit }) => {
      try {
        return performanceResult(await service.refreshPerformance(jobId.toLowerCase(), { limit }));
      } catch (error) {
        return failure(error, 'refresh_market_screen_performance');
      }
    }
  );

  server.registerTool(
    'list_market_screens',
    {
      title: 'List saved market-screen jobs',
      description:
        'List saved market-screen jobs newest first with origin (daily-report or manual), candidate source, status, matched/analyzed/unavailable counts and the US session date of creation. Default 10 jobs, maximum 50 per page. Reads saved state only; never starts, resumes or refreshes a job. Use the returned job id with get_market_screen or get_market_screen_performance.',
      inputSchema: listMarketScreensInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ offset, limit }) => {
      if (!service.list) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'list_market_screens: saved-job listing is unavailable in this server configuration. Use get_market_screen with a known job id.',
            },
          ],
          isError: true,
        };
      }
      try {
        const list = await service.list({ offset, limit });
        let dailyJobId: string | null = null;
        try {
          dailyJobId = (await service.dailyReport?.())?.jobId ?? null;
        } catch {
          // The daily-report label is informational; listing still succeeds without it.
        }
        return {
          content: [{ type: 'text' as const, text: renderJobList(list, dailyJobId) }],
          structuredContent: { ...list, dailyJobId },
          isError: false,
        };
      } catch (error) {
        return failure(error, 'list_market_screens');
      }
    }
  );

  server.registerTool(
    'get_daily_report',
    {
      title: 'Open the saved 09:00 daily report',
      description:
        'Read the latest saved daily screening run (09:00 Australia/Sydney) or the run for a given local date, with its collection coverage, analysis status, WhatsApp status, saved job id and the BUY matches. On zero-match days it also lists the nearest misses (excluded candidates by BUY score) in compact one-line form. Reads saved state only; never scans or notifies. Default format compact; limit 10 rows per section.',
      inputSchema: getDailyReportInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ date, limit, format }) => {
      if (!service.dailyReport) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'get_daily_report: daily-report state is unavailable in this server configuration. Use list_market_screens and get_market_screen instead.',
            },
          ],
          isError: true,
        };
      }
      try {
        const state = await service.dailyReport(date);
        if (!state) {
          return {
            content: [
              {
                type: 'text' as const,
                text: date
                  ? `get_daily_report: no daily run is saved for ${date} (Australia/Sydney). Omit date for the latest run, or run mise run daily-report -- --status to inspect the store.`
                  : 'get_daily_report: no daily run has been saved yet. Install the schedule with mise run daily-report:service:install, or use list_market_screens for manual jobs.',
              },
            ],
            isError: true,
          };
        }
        let matches: MarketScreenSnapshot | null = null;
        let nearMisses: MarketScreenSnapshot | null = null;
        if (state.jobId) {
          matches = await service.get(state.jobId, { kind: 'matches', offset: 0, limit });
          if (matches.page.total === 0 && matches.job.progress.excluded > 0) {
            nearMisses = await service.get(state.jobId, { kind: 'excluded', offset: 0, limit });
          }
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: renderDailyReport(state, matches, nearMisses, format),
            },
          ],
          structuredContent: {
            report: state,
            job: matches?.job ?? null,
            matches: matches?.page ?? null,
            nearMisses: nearMisses?.page ?? null,
          },
          isError: false,
        };
      } catch (error) {
        return failure(error, 'get_daily_report');
      }
    }
  );
}
