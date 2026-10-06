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

export interface PipelineConfigFile {
  version: typeof PIPELINE_CONFIG_VERSION;
  strategyId: typeof CANONICAL_STRATEGY_ID;
  updatedAt: string;
  config: PipelineConfig;
}

export interface PipelineConfigOptions {
  configPath?: string;
}

/** Every caller owns its snapshot; nested defaults are never shared mutable state. */
export function cloneCanonicalPipelineConfig(): PipelineConfig {
  return structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesCompleteShape(value: unknown, template: unknown): boolean {
  if (typeof template === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (typeof template === 'boolean' || typeof template === 'string') {
    return typeof value === typeof template;
  }
  if (!isRecord(template) || !isRecord(value)) return false;
  return Object.entries(template).every(([key, expected]) =>
    matchesCompleteShape(value[key], expected)
  );
}

/** Accept complete leader-pullback snapshots, never a merge of another strategy's weights. */
export function isLeaderPullbackPipelineConfig(value: unknown): value is PipelineConfig {
  if (!matchesCompleteShape(value, DEFAULT_QUALITY_PIPELINE_CONFIG)) return false;
  const config = value as PipelineConfig;
  const quality = config.qualityGate;
  if (
    config.strategy !== 'institutional' ||
    !config.institutional.enabled ||
    !config.trendGate.enabled ||
    config.trendGate.source !== 'gaussian' ||
    config.reversalConfirm.enabled ||
    !config.regimeFilter.enabled ||
    config.regimeFilter.blockUptrend ||
    !quality?.enabled ||
    quality.requireBelowSma50 !== true ||
    quality.rsMin === undefined ||
    !Object.entries(DEFAULT_QUALITY_PIPELINE_CONFIG.gradientRanges).every(([indicator, range]) =>
      Object.entries(range).every(
        ([bound, expected]) =>
          config.gradientRanges[indicator as keyof PipelineConfig['gradientRanges']][
            bound as keyof typeof range
          ] === expected
      )
    )
  ) {
    return false;
  }
  for (const key of ['requireMarketUptrend', 'requireAboveSma200'] as const) {
    if (quality[key] !== undefined && typeof quality[key] !== 'boolean') return false;
  }
  for (const key of ['vwapMin'] as const) {
    if (quality[key] !== undefined && !Number.isFinite(quality[key])) return false;
  }
  const weights = Object.values(config.institutional.weights);
  return (
    config.thresholds.buy > 0 &&
    config.thresholds.sell > 0 &&
    Object.values(config.indicatorWeights).every((weight) => weight >= 0) &&
    Object.values(config.patternWeights).every((weight) => Number.isFinite(weight)) &&
    config.calibration.slope > 0 &&
    weights.every((weight) => weight >= 0) &&
    weights.reduce((sum, weight) => sum + weight, 0) > 0 &&
    config.institutional.threshold >= 0 &&
    config.institutional.threshold <= 1 &&
    config.institutional.minAvgDailyDollarVol > 0 &&
    Number.isInteger(config.institutional.rsLookback.short) &&
    config.institutional.rsLookback.short > 0 &&
    Number.isInteger(config.institutional.rsLookback.long) &&
    config.institutional.rsLookback.long >= config.institutional.rsLookback.short &&
    quality.ibsMax > 0 &&
    quality.ibsMax <= 1 &&
    quality.atrPctMax > 0 &&
    quality.volRMin >= 0 &&
    quality.volRMax > quality.volRMin &&
    quality.rsMin >= 0 &&
    quality.rsMin <= 1 &&
    quality.scoreMax !== undefined &&
    quality.scoreMax > config.thresholds.buy &&
    Number.isInteger(config.clusterFilter.minGapDays) &&
    config.clusterFilter.minGapDays >= 0 &&
    Number.isInteger(config.confluence.minActive) &&
    config.confluence.minActive >= 1 &&
    config.confluence.activationThreshold >= 0 &&
    config.confluence.activationThreshold <= 1
  );
}

export async function loadPipelineConfig(
  options: PipelineConfigOptions = {}
): Promise<PipelineConfig> {
  try {
    const snapshot: unknown = JSON.parse(
      await readFile(options.configPath ?? CONFIG_PATH, 'utf-8')
    );
    if (
      !isRecord(snapshot) ||
      snapshot.version !== PIPELINE_CONFIG_VERSION ||
      snapshot.strategyId !== CANONICAL_STRATEGY_ID ||
      typeof snapshot.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(snapshot.updatedAt)) ||
      !isLeaderPullbackPipelineConfig(snapshot.config)
    ) {
      logger.warn(
        'Ignoring legacy or incompatible pipeline config; using leader-pullback defaults'
      );
      return cloneCanonicalPipelineConfig();
    }
    return structuredClone(snapshot.config);
  } catch {
    logger.debug('No usable pipeline config found; using leader-pullback defaults');
    return cloneCanonicalPipelineConfig();
  }
}

export async function savePipelineConfig(
  config: PipelineConfig,
  options: PipelineConfigOptions = {}
): Promise<void> {
  if (!isLeaderPullbackPipelineConfig(config)) {
    throw new TypeError('Only complete leader-pullback pipeline configurations can be saved');
  }
  const configPath = options.configPath ?? CONFIG_PATH;
  const tempPath = `${configPath}.${randomUUID()}.tmp`;
  const snapshot: PipelineConfigFile = {
    version: PIPELINE_CONFIG_VERSION,
    strategyId: CANONICAL_STRATEGY_ID,
    updatedAt: new Date().toISOString(),
    config: structuredClone(config),
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
