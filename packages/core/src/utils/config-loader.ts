import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import type { PipelineConfig } from '@/types';

const logger = pino({ name: 'pipeline-config', level: 'info' }, process.stderr);

export const CANONICAL_STRATEGY_ID = 'leader-pullback-v1';
export const PIPELINE_CONFIG_VERSION = '3.0.0';
export const CONFIG_PATH = fileURLToPath(
  new URL('../../../../data/config/optimized_weights.json', import.meta.url)
);

/** Readable alias accepted in config files for the shipped 'institutional' strategy name. */
export const LEADER_PULLBACK_STRATEGY_ALIAS = 'leader-pullback';
const CLUSTER_CONSUME_OPTIONS = ['all-setups', 'buys-only', 'pullback-setups'] as const;
const CLUSTER_GAP_UNITS = ['calendar', 'sessions'] as const;

export interface PipelineConfigFile {
  version: typeof PIPELINE_CONFIG_VERSION;
  strategyId: typeof CANONICAL_STRATEGY_ID;
  updatedAt: string;
  config: PipelineConfig;
}

export interface PipelineConfigOptions {
  configPath?: string;
  /**
   * Fail on a missing or invalid file instead of measuring the defaults.
   * Defaults to true whenever `configPath` is given explicitly; the implicit
   * data/config/optimized_weights.json stays lenient so a fresh checkout works.
   */
  strict?: boolean;
}

/** Raised when an explicitly requested pipeline configuration cannot be used. */
export class PipelineConfigError extends TypeError {
  readonly configPath: string;
  readonly rule: string;

  constructor(configPath: string, rule: string, cause?: unknown) {
    super(`Pipeline config ${configPath}: ${rule}`, cause === undefined ? undefined : { cause });
    this.name = 'PipelineConfigError';
    this.configPath = configPath;
    this.rule = rule;
  }
}

/** Every caller owns its snapshot; nested defaults are never shared mutable state. */
export function cloneCanonicalPipelineConfig(): PipelineConfig {
  return structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shapeMismatch(value: unknown, template: unknown, path: string): string | null {
  if (typeof template === 'number') {
    return typeof value === 'number' && Number.isFinite(value)
      ? null
      : `${path} must be a finite number`;
  }
  if (typeof template === 'boolean' || typeof template === 'string') {
    return typeof value === typeof template ? null : `${path} must be a ${typeof template}`;
  }
  if (!isRecord(template)) return null;
  if (!isRecord(value)) return `${path} must be an object`;
  for (const [key, expected] of Object.entries(template)) {
    const mismatch = shapeMismatch(
      value[key],
      expected,
      path === 'config' ? key : `${path}.${key}`
    );
    if (mismatch) return mismatch;
  }
  return null;
}

/**
 * Name the first validator rule a candidate snapshot violates, or null when it is
 * a complete leader-pullback configuration. Never merges another strategy's weights.
 */
export function explainPipelineConfigRejection(value: unknown): string | null {
  const shape = shapeMismatch(value, DEFAULT_QUALITY_PIPELINE_CONFIG, 'config');
  if (shape) return shape;
  const config = value as PipelineConfig;
  const quality = config.qualityGate;
  const rules: Array<[boolean, string]> = [
    [
      config.strategy === 'institutional' || config.strategy === LEADER_PULLBACK_STRATEGY_ALIAS,
      "strategy must be 'institutional' (alias 'leader-pullback')",
    ],
    [config.institutional.enabled, 'institutional.enabled must be true'],
    [config.trendGate.enabled, 'trendGate.enabled must be true'],
    [config.trendGate.source === 'gaussian', "trendGate.source must be 'gaussian'"],
    [!config.reversalConfirm.enabled, 'reversalConfirm.enabled must be false'],
    [config.regimeFilter.enabled, 'regimeFilter.enabled must be true'],
    [!config.regimeFilter.blockUptrend, 'regimeFilter.blockUptrend must be false'],
    [quality?.enabled === true, 'qualityGate.enabled must be true'],
    [quality?.requireBelowSma50 === true, 'qualityGate.requireBelowSma50 must be true'],
    [quality?.rsMin !== undefined, 'qualityGate.rsMin is required'],
  ];
  for (const [ok, rule] of rules) if (!ok) return rule;
  for (const [indicator, range] of Object.entries(DEFAULT_QUALITY_PIPELINE_CONFIG.gradientRanges)) {
    for (const [bound, expected] of Object.entries(range)) {
      if (
        config.gradientRanges[indicator as keyof PipelineConfig['gradientRanges']][
          bound as keyof typeof range
        ] !== expected
      ) {
        return `gradientRanges.${indicator}.${bound} must equal the leader-pullback value ${expected}`;
      }
    }
  }
  const q = quality as NonNullable<PipelineConfig['qualityGate']>;
  for (const key of ['requireMarketUptrend', 'requireAboveSma200'] as const) {
    if (q[key] !== undefined && typeof q[key] !== 'boolean') {
      return `qualityGate.${key} must be a boolean when present`;
    }
  }
  if (q.vwapMin !== undefined && !Number.isFinite(q.vwapMin)) {
    return 'qualityGate.vwapMin must be a finite number when present';
  }
  const cluster = config.clusterFilter;
  if (
    cluster.consume !== undefined &&
    !CLUSTER_CONSUME_OPTIONS.includes(cluster.consume as (typeof CLUSTER_CONSUME_OPTIONS)[number])
  ) {
    return `clusterFilter.consume must be one of ${CLUSTER_CONSUME_OPTIONS.join(', ')}`;
  }
  if (
    cluster.gapUnit !== undefined &&
    !CLUSTER_GAP_UNITS.includes(cluster.gapUnit as (typeof CLUSTER_GAP_UNITS)[number])
  ) {
    return `clusterFilter.gapUnit must be one of ${CLUSTER_GAP_UNITS.join(', ')}`;
  }
  const weights = Object.values(config.institutional.weights);
  const numeric: Array<[boolean, string]> = [
    [config.thresholds.buy > 0, 'thresholds.buy must be positive'],
    [config.thresholds.sell > 0, 'thresholds.sell must be positive'],
    [
      Object.values(config.indicatorWeights).every((weight) => weight >= 0),
      'indicatorWeights must be non-negative',
    ],
    [
      Object.values(config.patternWeights).every((weight) => Number.isFinite(weight)),
      'patternWeights must be finite numbers',
    ],
    [config.calibration.slope > 0, 'calibration.slope must be positive'],
    [weights.every((weight) => weight >= 0), 'institutional.weights must be non-negative'],
    [
      weights.reduce((sum, weight) => sum + weight, 0) > 0,
      'institutional.weights must sum to a positive value',
    ],
    [
      config.institutional.threshold >= 0 && config.institutional.threshold <= 1,
      'institutional.threshold must be within [0, 1]',
    ],
    [
      config.institutional.minAvgDailyDollarVol > 0,
      'institutional.minAvgDailyDollarVol must be positive',
    ],
    [
      Number.isInteger(config.institutional.rsLookback.short) &&
        config.institutional.rsLookback.short > 0,
      'institutional.rsLookback.short must be a positive integer',
    ],
    [
      Number.isInteger(config.institutional.rsLookback.long) &&
        config.institutional.rsLookback.long >= config.institutional.rsLookback.short,
      'institutional.rsLookback.long must be an integer >= rsLookback.short',
    ],
    [q.ibsMax > 0 && q.ibsMax <= 1, 'qualityGate.ibsMax must be within (0, 1]'],
    [q.atrPctMax > 0, 'qualityGate.atrPctMax must be positive'],
    [q.volRMin >= 0, 'qualityGate.volRMin must be non-negative'],
    [q.volRMax > q.volRMin, 'qualityGate.volRMax must exceed volRMin'],
    [
      (q.rsMin as number) >= 0 && (q.rsMin as number) <= 1,
      'qualityGate.rsMin must be within [0, 1]',
    ],
    [
      q.scoreMax !== undefined && q.scoreMax > config.thresholds.buy,
      'qualityGate.scoreMax must be present and exceed thresholds.buy',
    ],
    [
      Number.isInteger(cluster.minGapDays) && cluster.minGapDays >= 0,
      'clusterFilter.minGapDays must be a non-negative integer',
    ],
    [
      Number.isInteger(config.confluence.minActive) && config.confluence.minActive >= 1,
      'confluence.minActive must be an integer >= 1',
    ],
    [
      config.confluence.activationThreshold >= 0 && config.confluence.activationThreshold <= 1,
      'confluence.activationThreshold must be within [0, 1]',
    ],
  ];
  for (const [ok, rule] of numeric) if (!ok) return rule;
  return null;
}

/** Accept complete leader-pullback snapshots, never a merge of another strategy's weights. */
export function isLeaderPullbackPipelineConfig(value: unknown): value is PipelineConfig {
  return explainPipelineConfigRejection(value) === null;
}

/** Map the readable alias onto the canonical strategy name so every consumer sees one value. */
function normalizeStrategyAlias(config: PipelineConfig): PipelineConfig {
  if (config.strategy === LEADER_PULLBACK_STRATEGY_ALIAS) config.strategy = 'institutional';
  return config;
}

function explainSnapshotRejection(snapshot: unknown): string | null {
  if (!isRecord(snapshot)) return 'file must contain a JSON object';
  if (snapshot.version !== PIPELINE_CONFIG_VERSION) {
    return `version must be ${PIPELINE_CONFIG_VERSION}`;
  }
  if (snapshot.strategyId !== CANONICAL_STRATEGY_ID) {
    return `strategyId must be ${CANONICAL_STRATEGY_ID}`;
  }
  if (typeof snapshot.updatedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.updatedAt))) {
    return 'updatedAt must be an ISO-8601 timestamp';
  }
  return explainPipelineConfigRejection(snapshot.config);
}

export async function loadPipelineConfig(
  options: PipelineConfigOptions = {}
): Promise<PipelineConfig> {
  const configPath = options.configPath ?? CONFIG_PATH;
  const strict = options.strict ?? options.configPath !== undefined;
  let text: string;
  try {
    text = await readFile(configPath, 'utf-8');
  } catch (error) {
    if (strict) throw new PipelineConfigError(configPath, 'file could not be read', error);
    logger.debug('No usable pipeline config found; using leader-pullback defaults');
    return cloneCanonicalPipelineConfig();
  }
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(text);
  } catch (error) {
    if (strict) throw new PipelineConfigError(configPath, 'file is not valid JSON', error);
    logger.debug('No usable pipeline config found; using leader-pullback defaults');
    return cloneCanonicalPipelineConfig();
  }
  const rule = explainSnapshotRejection(snapshot);
  if (rule) {
    if (strict) throw new PipelineConfigError(configPath, rule);
    logger.warn(
      { rule },
      'Ignoring legacy or incompatible pipeline config; using leader-pullback defaults'
    );
    return cloneCanonicalPipelineConfig();
  }
  return normalizeStrategyAlias(structuredClone((snapshot as PipelineConfigFile).config));
}

export async function savePipelineConfig(
  config: PipelineConfig,
  options: PipelineConfigOptions = {}
): Promise<void> {
  const rule = explainPipelineConfigRejection(config);
  if (rule) {
    throw new TypeError(
      `Only complete leader-pullback pipeline configurations can be saved: ${rule}`
    );
  }
  const configPath = options.configPath ?? CONFIG_PATH;
  const tempPath = `${configPath}.${randomUUID()}.tmp`;
  const snapshot: PipelineConfigFile = {
    version: PIPELINE_CONFIG_VERSION,
    strategyId: CANONICAL_STRATEGY_ID,
    updatedAt: new Date().toISOString(),
    config: normalizeStrategyAlias(structuredClone(config)),
  };
  await mkdir(dirname(configPath), { recursive: true });
  try {
    await writeFile(tempPath, JSON.stringify(snapshot, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    await rename(tempPath, configPath);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}
