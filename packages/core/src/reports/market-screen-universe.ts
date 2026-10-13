import { DateTime } from 'luxon';
import { CONFIGURED_UNIVERSE_NAME, CONFIGURED_UNIVERSE_TICKERS } from '@/constants/tickers';

/**
 * Candidate-universe provenance for durable market screens.
 *
 * Two sources exist. The configured universe is the ticker list the leader-pullback
 * strategy was validated on (`docs/validation/leader-pullback-2026-10-06`); Finviz
 * candidates are a discovery lane whose population was never measured. Saved jobs
 * carry `universe.source` and `universe.validated` so every reader can tell them apart.
 */

export const FINVIZ_COLLECTION_REASONS = [
  'candidate-limit',
  'page-limit',
  'deadline',
  'access-blocked',
  'unsupported-page',
  'source-changed',
  'incomplete-collection',
  'browser-unavailable',
  'browser-error',
] as const;
export type FinvizCollectionReason = (typeof FINVIZ_COLLECTION_REASONS)[number];

/** Collection stopped by a configured cap rather than by a failure. */
const CAPPED_BY_DESIGN: ReadonlySet<FinvizCollectionReason> = new Set([
  'candidate-limit',
  'page-limit',
]);

export interface FinvizScreenProvenance {
  source: 'Finviz';
  url: string;
  filters: string[];
  sourceTotal: number;
  capturedAt: string;
  completeness: 'complete' | 'partial';
  overallTotal?: number;
  pages?: number;
  /** Why collection stopped early; null when the whole filtered source was collected. */
  collectionReason?: FinvizCollectionReason | null;
}

export interface ConfiguredUniverseProvenance {
  source: 'configured-universe';
  /** Name of the configured list, currently always `CONFIGURED_UNIVERSE_NAME`. */
  name: string;
  capturedAt: string;
}

export type MarketScreenProvenance = FinvizScreenProvenance | ConfiguredUniverseProvenance;

export type MarketScreenUniverseSource = 'finviz-candidates' | 'configured-universe';

interface UniverseBase {
  source: MarketScreenUniverseSource;
  /** Whether the strategy edge was measured on this population; legacy jobs omit it. */
  validated?: boolean;
  sourceTotal: number;
  collectedCount: number;
  inputCount: number;
  capturedAt: string;
  completeness: 'complete' | 'partial';
  overallTotal: number | null;
  pages: number | null;
}

export interface FinvizCandidateUniverse extends UniverseBase {
  source: 'finviz-candidates';
  /** Optional only so legacy saved jobs and older fixtures still type-check. */
  validated?: false;
  url: string;
  filters: string[];
  collectionReason?: FinvizCollectionReason | null;
}

export interface ConfiguredUniverse extends UniverseBase {
  source: 'configured-universe';
  validated: true;
  name: string;
  url: null;
  filters: [];
  completeness: 'complete';
  collectionReason: null;
}

export type MarketScreenUniverse = FinvizCandidateUniverse | ConfiguredUniverse;

export type MarketScreenCollectionStatus = 'complete' | 'capped' | 'partial';

const FINVIZ_PARAMETERS = new Set(['v', 'f', 'ft', 'o', 'r', 't', 's', 'c', 'ar', 'p', 'ta']);

export function configuredUniverseCandidates(): string[] {
  return [...CONFIGURED_UNIVERSE_TICKERS];
}

export function configuredUniverseProvenance(now: Date = new Date()): ConfiguredUniverseProvenance {
  return {
    source: 'configured-universe',
    name: CONFIGURED_UNIVERSE_NAME,
    capturedAt: now.toISOString(),
  };
}

function validateCapturedAt(value: unknown): string {
  const capturedAt = typeof value === 'string' ? DateTime.fromISO(value, { setZone: true }) : null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !capturedAt?.isValid ||
    capturedAt.toMillis() > Date.now()
  )
    throw new TypeError('capturedAt must be a valid past ISO timestamp');
  return capturedAt.toUTC().toISO() as string;
}

function validateFinviz(
  provenance: FinvizScreenProvenance,
  tickers: string[],
  inputCount: number
): FinvizCandidateUniverse {
  if (!['complete', 'partial'].includes(provenance.completeness))
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
  const capturedAt = validateCapturedAt(provenance.capturedAt);
  for (const field of ['overallTotal', 'pages'] as const) {
    const value = provenance[field];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
      throw new TypeError(`${field} must be a positive integer`);
  }
  if (provenance.overallTotal !== undefined && provenance.overallTotal < provenance.sourceTotal)
    throw new TypeError('overallTotal must cover sourceTotal');
  const collectionReason = provenance.collectionReason ?? null;
  if (
    collectionReason !== null &&
    !FINVIZ_COLLECTION_REASONS.includes(collectionReason as FinvizCollectionReason)
  )
    throw new TypeError('collectionReason must be a known Finviz collection outcome');
  return {
    source: 'finviz-candidates',
    validated: false,
    url: url.href,
    filters: [...provenance.filters],
    sourceTotal: provenance.sourceTotal,
    collectedCount: tickers.length,
    inputCount,
    capturedAt,
    completeness: provenance.completeness,
    overallTotal: provenance.overallTotal ?? null,
    pages: provenance.pages ?? null,
    collectionReason: provenance.completeness === 'partial' ? collectionReason : null,
  };
}

function validateConfigured(
  provenance: ConfiguredUniverseProvenance,
  tickers: string[],
  inputCount: number
): ConfiguredUniverse {
  if (provenance.name !== CONFIGURED_UNIVERSE_NAME)
    throw new TypeError('Unknown configured universe');
  return {
    source: 'configured-universe',
    validated: true,
    name: provenance.name,
    url: null,
    filters: [],
    sourceTotal: tickers.length,
    collectedCount: tickers.length,
    inputCount,
    capturedAt: validateCapturedAt(provenance.capturedAt),
    completeness: 'complete',
    overallTotal: null,
    pages: null,
    collectionReason: null,
  };
}

/**
 * Validates caller-declared provenance against the unique symbol list and freezes
 * the saved `universe` block. Error messages are part of the public MCP/API contract.
 */
export function buildMarketScreenUniverse(
  provenance: MarketScreenProvenance | undefined,
  tickers: string[],
  inputCount: number
): MarketScreenUniverse {
  if (provenance?.source === 'Finviz') return validateFinviz(provenance, tickers, inputCount);
  if (provenance?.source === 'configured-universe')
    return validateConfigured(provenance, tickers, inputCount);
  throw new TypeError('Valid Finviz provenance is required');
}

export function isValidatedUniverse(universe: Pick<MarketScreenUniverse, 'source'>): boolean {
  return universe.source === 'configured-universe';
}

/** Coverage classification that separates a by-design cap from a collection failure. */
export function classifyCollection(
  universe: Pick<MarketScreenUniverse, 'completeness' | 'collectionReason'>
): MarketScreenCollectionStatus {
  if (universe.completeness === 'complete') return 'complete';
  const reason = universe.collectionReason ?? null;
  return reason !== null && CAPPED_BY_DESIGN.has(reason) ? 'capped' : 'partial';
}

/** Short title segment: `Finviz 후보 2/3916` or `검증 유니버스 555종목`. */
export function describeUniverseCoverage(
  universe: Pick<MarketScreenUniverse, 'source' | 'collectedCount' | 'sourceTotal'>
): string {
  if (universe.source === 'configured-universe')
    return `검증 유니버스 ${universe.collectedCount}종목`;
  return `Finviz 후보 ${universe.collectedCount}/${universe.sourceTotal}`;
}

/** One summary line for notifications and saved coverage summaries. */
export function describeUniverseCollection(
  universe: Pick<
    MarketScreenUniverse,
    'source' | 'collectedCount' | 'sourceTotal' | 'completeness' | 'collectionReason'
  >
): string {
  if (universe.source === 'configured-universe')
    return `검증 유니버스 ${universe.collectedCount}종목 · 전체 평가`;
  const collection = classifyCollection(universe);
  const label =
    collection === 'complete' ? '완전 수집' : collection === 'capped' ? '상한 수집' : '부분 수집';
  return `Finviz 후보 수집 ${universe.collectedCount}/${universe.sourceTotal} · ${label} · 미검증 유니버스`;
}

export function universeWarnings(universe: MarketScreenUniverse): string[] {
  if (universe.source === 'configured-universe') {
    return [
      `This job evaluates the configured validated universe (${universe.name}, ${universe.collectedCount} tickers); the engine final decision alone qualifies a BUY.`,
      'The configured universe is the population the leader-pullback edge was measured on; it is not every US-listed stock.',
    ];
  }
  return [
    'Finviz filters select candidates; they do not determine the engine final BUY, SELL, or HOLD decision.',
    'This job covers only the frozen collected Finviz candidate list, not every US-listed stock or every filtered source candidate when collection is partial.',
    'Finviz candidates are an unvalidated discovery universe; the measured leader-pullback edge applies to the configured universe only.',
    ...(universe.completeness === 'partial'
      ? [
          `Only ${universe.collectedCount} of ${universe.sourceTotal} declared Finviz candidates were collected; missing candidates were not evaluated.`,
        ]
      : []),
  ];
}

export interface ScanDurationEstimate {
  candidates: number;
  concurrency: number;
  minIntervalMs: number;
  perTickerMs: number;
  estimatedMs: number;
}

/**
 * Wall-clock estimate for a scan: each worker waits `minIntervalMs` between starts
 * and spends about `perTickerMs` of provider latency per candidate.
 */
export function estimateScanDuration(
  candidates: number,
  options: { concurrency?: number; minIntervalMs?: number; perTickerMs?: number } = {}
): ScanDurationEstimate {
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const minIntervalMs = Math.max(0, options.minIntervalMs ?? 1_000);
  const perTickerMs = Math.max(0, options.perTickerMs ?? 2_500);
  const perWorker = Math.ceil(Math.max(0, candidates) / concurrency);
  return {
    candidates,
    concurrency,
    minIntervalMs,
    perTickerMs,
    estimatedMs: perWorker * Math.max(minIntervalMs, perTickerMs),
  };
}
