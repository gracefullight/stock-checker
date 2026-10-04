import type { McpServer } from '@modelcontextprotocol/server';
import type {
  createMarketScreenJob,
  getMarketScreenJob,
  pauseMarketScreenJob,
  runMarketScreenJob,
} from '@stock-checker/core/src/reports/market-screen.ts';
import { z } from 'zod/v4';

export interface MarketScreenService {
  create: typeof createMarketScreenJob;
  get: typeof getMarketScreenJob;
  resume: typeof runMarketScreenJob;
  pause: typeof pauseMarketScreenJob;
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
});

export const controlMarketScreenInput = z.strictObject({
  jobId: jobIdInput,
  action: z.enum(['resume', 'pause']),
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
};

type MarketScreenSnapshot = Awaited<ReturnType<MarketScreenService['get']>>;

const escapeMarkdown = (value: string): string => value.replace(/[\\`*_{}[\]()#+.!|<>-]/g, '\\$&');
const numeric = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : 'N/A');

function renderSnapshot(snapshot: MarketScreenSnapshot): string {
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
    `Result page: ${page.kind}, offset ${page.offset}, limit ${page.limit}; ${page.total} total rows${page.hasMore ? '; more pages available' : ''}.`,
    ...(job.pauseReason ? [`Pause reason: ${job.pauseReason}`] : []),
    '',
    'The Finviz filtered candidate list is separate from Stock Checker’s final engine decisions. Scores are not win probabilities. Use get_market_screen to read progress and further result pages. Pass the same lookbackDays when inspecting a candidate with analyze_stock or show_stock_dashboard.',
  ];
  if (page.items.length) {
    lines.push('', '## Result page', '');
    if (page.kind === 'unavailable') {
      for (const item of page.items) {
        if ('reason' in item)
          lines.push(`- ${escapeMarkdown(item.ticker)}: ${escapeMarkdown(item.reason)}`);
      }
    } else {
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
    }
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

function snapshotResult(snapshot: MarketScreenSnapshot) {
  return {
    content: [{ type: 'text' as const, text: renderSnapshot(snapshot) }],
    structuredContent: { ...snapshot },
    isError: false,
  };
}

const failure = () => ({
  content: [
    {
      type: 'text' as const,
      text: 'The market-screen job request could not be completed. Check the job ID and candidate metadata, then try again.',
    },
  ],
  isError: true,
});

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
      } catch {
        return failure();
      }
    }
  );

  server.registerTool(
    'get_market_screen',
    {
      title: 'Read market-screen progress and a result page',
      description:
        'Read a durable market-screen job’s progress, Finviz collection coverage and a bounded page of matched, excluded or unavailable tickers. Defaults to matches offset 0, limit 20; maximum 100 rows. Does not start or resume analysis. Completed job status describes the supplied candidate list, not independently verified whole-market coverage.',
      inputSchema: getMarketScreenInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ jobId, kind, offset, limit }) => {
      try {
        return snapshotResult(await service.get(jobId, { kind, offset, limit }));
      } catch {
        return failure();
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
      } catch {
        return failure();
      }
    }
  );
}
