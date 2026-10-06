import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import type { FinvizScreenProvenance } from '@/reports/market-screen';

export interface FinvizCollectionPlan {
  url: string;
  filters: readonly string[];
}

export interface FinvizCollectorOptions {
  plan?: FinvizCollectionPlan;
  maxCandidates?: number;
  maxPages?: number;
  timeBudgetMs?: number;
  minIntervalMs?: number;
  asideExecutable?: string;
}

export type FinvizCollectionReason =
  | 'candidate-limit'
  | 'page-limit'
  | 'deadline'
  | 'access-blocked'
  | 'unsupported-page'
  | 'source-changed'
  | 'incomplete-collection'
  | 'browser-unavailable'
  | 'browser-error';

export interface FinvizCollectionResult {
  status: 'available' | 'partial' | 'unavailable';
  tickers: string[];
  provenance: FinvizScreenProvenance | null;
  reason: FinvizCollectionReason | null;
}

export interface FinvizBrowserPage {
  url: string;
  snapshot: string;
  links: { name: string; href: string | null }[];
}

interface PageRequest {
  timeoutMs: number;
  asideExecutable?: string;
}

export interface FinvizCollectorDependencies {
  readPage?: (url: string, request: PageRequest) => Promise<FinvizBrowserPage>;
  resolveAside?: (explicitPath?: string) => Promise<string | null>;
  executeAside?: (
    executable: string,
    args: string[],
    options: { timeout: number; maxBuffer: number; encoding: 'utf8'; killSignal: 'SIGTERM' }
  ) => Promise<{ stdout: string }>;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

const runFile = promisify(execFile);
const MARKER = 'STOCK_CHECKER_FINVIZ_PAGE:';
const MAX_OUTPUT_BYTES = 2_000_000;
const SYMBOL = /^\^?[A-Z0-9]+(?:[.-][A-Z0-9]+)*(?:=[A-Z0-9]+)?$/;
const ALLOWED_PARAMETERS = new Set(['v', 'f', 'o', 'r']);

class CollectionFailure extends Error {
  constructor(readonly reason: FinvizCollectionReason) {
    super(reason);
  }
}

/** Same BUY prefilters as prepare_finviz_screen; ordering only changes capped selection. */
export function defaultFinvizCollectionPlan(): FinvizCollectionPlan {
  const filters = [
    'ind_stocksonly',
    ...(DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate.enabled &&
    DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate.requireBelowSma50
      ? ['ta_sma50_pb']
      : []),
  ];
  const url = new URL('https://finviz.com/screener');
  url.searchParams.set('v', '411');
  url.searchParams.set('f', filters.join(','));
  url.searchParams.set('o', '-volume');
  return { url: url.href, filters };
}

/** Filesystem-only readiness: no browser, provider, account, or session requests. */
export async function resolveAsideExecutable(explicitPath?: string): Promise<string | null> {
  if (
    explicitPath !== undefined &&
    (!isAbsolute(explicitPath) || /[\p{Cc}\p{Cf}]/u.test(explicitPath))
  ) {
    return null;
  }
  const candidates = explicitPath
    ? [explicitPath]
    : [
        join(homedir(), '.local', 'bin', 'aside'),
        ...(process.env.PATH ?? '')
          .split(delimiter)
          .filter((directory) => isAbsolute(directory))
          .map((directory) => join(directory, 'aside')),
      ];
  for (const candidate of new Set(candidates)) {
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try another known installation location without exposing local paths.
    }
  }
  return null;
}

export async function isFinvizBrowserAvailable(
  options: Pick<FinvizCollectorOptions, 'asideExecutable'> = {}
): Promise<boolean> {
  return (await resolveAsideExecutable(options.asideExecutable)) !== null;
}

function sourceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CollectionFailure('unsupported-page');
  }
  const keys = [...url.searchParams.keys()];
  if (
    value.length > 2048 ||
    /[\p{Cc}\p{Cf}]/u.test(value) ||
    url.origin !== 'https://finviz.com' ||
    !['/screener', '/screener.ashx'].includes(url.pathname) ||
    url.username ||
    url.password ||
    url.hash ||
    keys.some((key, index) => !ALLOWED_PARAMETERS.has(key) || keys.indexOf(key) !== index) ||
    url.searchParams.get('v') !== '411' ||
    !/^(?:-?volume|-?ticker)?$/.test(url.searchParams.get('o') ?? '') ||
    !/^[1-9]\d{0,6}$/.test(url.searchParams.get('r') ?? '1')
  ) {
    throw new CollectionFailure('unsupported-page');
  }
  return url;
}

function validatePlan(plan: FinvizCollectionPlan): URL {
  const url = sourceUrl(plan.url);
  const filters = url.searchParams.get('f')?.split(',') ?? [];
  if (
    !Array.isArray(plan.filters) ||
    plan.filters.length === 0 ||
    plan.filters.length > 100 ||
    plan.filters.some((filter) => !/^[A-Za-z0-9_][A-Za-z0-9_.+-]{0,159}$/.test(filter)) ||
    new Set(plan.filters).size !== plan.filters.length ||
    JSON.stringify(filters) !== JSON.stringify(plan.filters) ||
    !plan.filters.includes('ind_stocksonly') ||
    Number(url.searchParams.get('r') ?? 1) !== 1
  ) {
    throw new TypeError('A public Finviz Tickers plan with exact ordered filters is required');
  }
  return url;
}

function matchesSource(url: URL, source: URL): boolean {
  return (
    url.pathname === source.pathname &&
    url.searchParams.get('v') === source.searchParams.get('v') &&
    url.searchParams.get('f') === source.searchParams.get('f') &&
    (url.searchParams.get('o') ?? '') === (source.searchParams.get('o') ?? '')
  );
}

interface ParsedPage {
  sourceTotal: number;
  tickers: string[];
  nextUrl: string | null;
}

function parsePage(page: FinvizBrowserPage, requested: URL, source: URL): ParsedPage {
  if (
    !page ||
    typeof page.snapshot !== 'string' ||
    page.snapshot.length > MAX_OUTPUT_BYTES ||
    !Array.isArray(page.links) ||
    page.links.length > 64
  ) {
    throw new CollectionFailure('unsupported-page');
  }
  if (
    /just a moment|verify (?:that )?you are human|security check|checking (?:your )?browser|access denied|captcha|cloudflare|^- title: "(?:login|sign in)/im.test(
      page.snapshot
    )
  ) {
    throw new CollectionFailure('access-blocked');
  }
  const actual = sourceUrl(page.url);
  const start = Number(requested.searchParams.get('r') ?? 1);
  if (!matchesSource(actual, source) || Number(actual.searchParams.get('r') ?? 1) !== start) {
    throw new CollectionFailure('source-changed');
  }
  // Grounded in the public Tickers accessibility tree: "#1 / 3916 Total",
  // followed by generic symbol cells, then the numeric pagination links.
  const totals = [...page.snapshot.matchAll(/^- text: "#([\d,]+) \/ ([\d,]+) Total"$/gm)];
  if (totals.length !== 1) throw new CollectionFailure('unsupported-page');
  const total = totals[0];
  const sourceTotal = Number(total[2].replaceAll(',', ''));
  if (
    !Number.isSafeInteger(sourceTotal) ||
    sourceTotal < 0 ||
    sourceTotal > 1_000_000 ||
    Number(total[1].replaceAll(',', '')) !== start
  ) {
    throw new CollectionFailure('unsupported-page');
  }
  const tail = page.snapshot.slice((total.index ?? 0) + total[0].length);
  const pagination = /^- link "\d+" \[ref=[A-Za-z0-9]+\]/m.exec(tail);
  const region = pagination ? tail.slice(0, pagination.index) : tail;
  const tickers = [...region.matchAll(/^- generic "([^"\n]*)" \[ref=[A-Za-z0-9]+\]$/gm)].map(
    (match) => match[1].trim().toUpperCase()
  );
  if (
    tickers.some((ticker) => ticker.length > 32 || !SYMBOL.test(ticker)) ||
    tickers.length > 15_000 ||
    (sourceTotal > 0 && tickers.length === 0) ||
    (sourceTotal === 0 && tickers.length > 0) ||
    start + tickers.length - 1 > sourceTotal
  ) {
    throw new CollectionFailure('unsupported-page');
  }
  const next = new Map<number, string>();
  for (const link of page.links) {
    if (!link || typeof link.name !== 'string') throw new CollectionFailure('unsupported-page');
    const numeric = /^\d+$/.test(link.name);
    if (!numeric && link.name !== '') continue;
    let candidate: URL;
    try {
      candidate = sourceUrl(new URL(link.href ?? '', actual).href);
    } catch {
      if (numeric) throw new CollectionFailure('unsupported-page');
      continue;
    }
    if (!matchesSource(candidate, source)) {
      if (numeric) throw new CollectionFailure('source-changed');
      continue;
    }
    const offset = Number(candidate.searchParams.get('r') ?? 1);
    if (offset > start) next.set(offset, candidate.href);
  }
  const nextOffset = next.size ? Math.min(...next.keys()) : null;
  if (nextOffset !== null && (nextOffset !== start + tickers.length || nextOffset > sourceTotal)) {
    throw new CollectionFailure('incomplete-collection');
  }
  return {
    sourceTotal,
    tickers,
    nextUrl: nextOffset === null ? null : (next.get(nextOffset) ?? null),
  };
}

function browserCode(url: string, timeoutMs: number): string {
  // One CLI call owns one new public tab. Never attach to or close user tabs.
  return `await (async () => {
    let owned;
    let finished = false;
    const until = Date.now() + ${Math.max(1, timeoutMs - 1000)};
    const inBudget = async (operation) => {
      let timer;
      try {
        return await Promise.race([operation, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('deadline')), Math.max(0, until - Date.now()));
        })]);
      } finally { clearTimeout(timer); }
    };
    try {
      const opening = openTab(${JSON.stringify(url)});
      opening.then(tab => { if (finished) closeTab(tab).catch(() => {}); }, () => {});
      owned = await inBudget(opening);
      const current = await inBudget(snapshot(owned, { interactive: true }));
      const links = [];
      for (const match of current.tree.matchAll(/- link(?: "([^"]*)")? \\[ref=([^\\]]+)\\]/g)) {
        if ((!match[1] || /^\\d+$/.test(match[1])) && /^[A-Za-z0-9]+$/.test(match[2])) {
          if (links.length >= 64) throw new Error('unsupported-page');
          links.push({name: match[1] || '', href: await inBudget(owned.locator(match[2]).getAttribute('href'))});
        }
      }
      console.log(${JSON.stringify(MARKER)} + JSON.stringify({url: owned.url(), snapshot: current.tree, links}));
    } catch {
      console.log(${JSON.stringify(MARKER)} + JSON.stringify({error: Date.now() >= until ? 'deadline' : 'browser-error'}));
    } finally {
      finished = true;
      if (owned) await closeTab(owned);
    }
  })()`;
}

async function readAsidePage(
  url: string,
  request: PageRequest,
  dependencies: FinvizCollectorDependencies
): Promise<FinvizBrowserPage> {
  const executable = await (dependencies.resolveAside ?? resolveAsideExecutable)(
    request.asideExecutable
  );
  if (!executable) throw new CollectionFailure('browser-unavailable');
  try {
    const { stdout } = await (dependencies.executeAside ?? runFile)(
      executable,
      ['repl', '--host', 'local', browserCode(url, request.timeoutMs)],
      {
        // The browser script times out first, leaving a bounded cleanup grace.
        timeout: request.timeoutMs + 1500,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: 'utf8',
        killSignal: 'SIGTERM',
      }
    );
    const results = stdout.split(/\r?\n/).filter((line) => line.startsWith(MARKER));
    if (results.length !== 1) throw new CollectionFailure('unsupported-page');
    const parsed = JSON.parse(results[0].slice(MARKER.length)) as FinvizBrowserPage & {
      error?: string;
    };
    if (parsed?.error)
      throw new CollectionFailure(parsed.error === 'deadline' ? 'deadline' : 'browser-error');
    return parsed;
  } catch (error) {
    if (error instanceof CollectionFailure) throw error;
    throw new CollectionFailure('browser-error');
  }
}

function limit(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum)
    throw new TypeError('Invalid Finviz collection limits');
  return result;
}

async function bounded<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CollectionFailure('deadline')), milliseconds);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Public browser navigation only: no HTTP crawler, login, challenge bypass or retries. */
export async function collectFinvizCandidates(
  options: FinvizCollectorOptions = {},
  dependencies: FinvizCollectorDependencies = {}
): Promise<FinvizCollectionResult> {
  const plan = options.plan ?? defaultFinvizCollectionPlan();
  const source = validatePlan(plan);
  const maxCandidates = limit(options.maxCandidates, 200, 1, 15_000);
  const maxPages = limit(options.maxPages, 10, 1, 30);
  const timeBudget = limit(options.timeBudgetMs, 60_000, 1, 120_000);
  const minInterval = limit(options.minIntervalMs, 2_000, 0, 30_000);
  const now = dependencies.now ?? Date.now;
  const wait =
    dependencies.wait ??
    ((duration) => new Promise<void>((resolve) => setTimeout(resolve, duration)));
  const readPage =
    dependencies.readPage ?? ((url, request) => readAsidePage(url, request, dependencies));
  const deadline = now() + timeBudget;
  const capturedAt = new Date(now()).toISOString();
  const tickers = new Set<string>();
  let sourceTotal: number | null = null;
  let pages = 0;
  let lastStarted: number | null = null;
  let nextUrl: string | null = source.href;
  let reason: FinvizCollectionReason | null = null;
  try {
    while (nextUrl) {
      if (pages >= maxPages) throw new CollectionFailure('page-limit');
      const remaining = deadline - now();
      if (remaining <= 0) throw new CollectionFailure('deadline');
      const delay = lastStarted === null ? 0 : Math.max(0, minInterval - (now() - lastStarted));
      if (delay >= remaining) throw new CollectionFailure('deadline');
      if (delay) await bounded(wait(delay), remaining);
      const requestBudget = deadline - now();
      if (requestBudget <= 0) throw new CollectionFailure('deadline');
      lastStarted = now();
      const requested = sourceUrl(nextUrl);
      const page = await bounded(
        readPage(nextUrl, { timeoutMs: requestBudget, asideExecutable: options.asideExecutable }),
        requestBudget
      );
      if (now() >= deadline) throw new CollectionFailure('deadline');
      const parsed = parsePage(page, requested, source);
      if (sourceTotal !== null && sourceTotal !== parsed.sourceTotal)
        throw new CollectionFailure('source-changed');
      sourceTotal = parsed.sourceTotal;
      pages++;
      for (const ticker of parsed.tickers) {
        if (tickers.size >= maxCandidates && !tickers.has(ticker)) break;
        tickers.add(ticker);
      }
      nextUrl = parsed.nextUrl;
      if (tickers.size >= maxCandidates && (sourceTotal > tickers.size || nextUrl))
        throw new CollectionFailure('candidate-limit');
      if (!nextUrl && tickers.size !== sourceTotal)
        throw new CollectionFailure('incomplete-collection');
    }
  } catch (error) {
    reason = error instanceof CollectionFailure ? error.reason : 'browser-error';
  }
  return {
    status: sourceTotal === null ? 'unavailable' : reason ? 'partial' : 'available',
    tickers: [...tickers],
    provenance:
      sourceTotal === null
        ? null
        : {
            source: 'Finviz',
            url: source.href,
            filters: [...plan.filters],
            sourceTotal,
            capturedAt,
            completeness: reason ? 'partial' : 'complete',
            pages,
          },
    reason,
  };
}
