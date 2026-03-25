/**
 * Dynamic Configuration Loader
 * Loads optimized weights and calibration parameters from JSON
 * Falls back to default constants if no optimized config exists
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pino from 'pino';
import {
  BUY_THRESHOLD,
  DEFAULT_PIPELINE_CONFIG,
  INDICATOR_WEIGHTS,
  PATTERN_WEIGHTS,
  SELL_THRESHOLD,
} from '@/constants';
import type {
  ConfluenceConfig,
  GradientRanges,
  ReversalConfig,
  TrendGateConfig,
} from '@/types';

const logger = pino({
  level: 'info',
  transport: { target: 'pino-pretty' },
});

const CONFIG_PATH = join(process.cwd(), 'data', 'config', 'optimized_weights.json');

export interface CalibrationParams {
  slope: number;
  intercept: number;
}

export interface OptimizedWeights {
  weights: Record<string, number>;
  thresholds: {
    buy: number;
    sell: number;
  };
  patternWeights: Record<string, number>;
  calibration: CalibrationParams;
  // V2 pipeline fields (optional for backward compat with v1 configs)
  trendGate?: TrendGateConfig;
  gradientRanges?: GradientRanges;
  confluence?: ConfluenceConfig;
  reversalConfirm?: ReversalConfig;
}

export interface ConfigFile extends OptimizedWeights {
  version: string;
  updatedAt: string;
}

/**
 * Load optimized configuration from JSON
 * Falls back to default constants if file doesn't exist
 * Accepts both v1.0.0 and v2.0.0 configs
 */
export async function loadOptimizedConfig(): Promise<OptimizedWeights> {
  try {
    const data = await readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(data) as ConfigFile;

    if (config.version !== '1.0.0' && config.version !== '2.0.0') {
      logger.warn(`Config version mismatch: ${config.version}, using defaults`);
      return getDefaultConfig();
    }

    return {
      weights: { ...INDICATOR_WEIGHTS, ...config.weights },
      thresholds: {
        buy: config.thresholds?.buy ?? BUY_THRESHOLD,
        sell: config.thresholds?.sell ?? SELL_THRESHOLD,
      },
      patternWeights: { ...PATTERN_WEIGHTS, ...config.patternWeights },
      calibration: config.calibration ?? { slope: 0.01, intercept: -1.0 },
      trendGate: config.trendGate ?? DEFAULT_PIPELINE_CONFIG.trendGate,
      gradientRanges: config.gradientRanges ?? DEFAULT_PIPELINE_CONFIG.gradientRanges,
      confluence: config.confluence ?? DEFAULT_PIPELINE_CONFIG.confluence,
      reversalConfirm: config.reversalConfirm ?? DEFAULT_PIPELINE_CONFIG.reversalConfirm,
    };
  } catch (_error) {
    logger.debug('No optimized config found, using defaults');
    return getDefaultConfig();
  }
}

/**
 * Get default configuration
 */
function getDefaultConfig(): OptimizedWeights {
  return {
    weights: { ...INDICATOR_WEIGHTS },
    thresholds: {
      buy: BUY_THRESHOLD,
      sell: SELL_THRESHOLD,
    },
    patternWeights: { ...PATTERN_WEIGHTS },
    calibration: { slope: 0.01, intercept: -1.0 },
    trendGate: DEFAULT_PIPELINE_CONFIG.trendGate,
    gradientRanges: DEFAULT_PIPELINE_CONFIG.gradientRanges,
    confluence: DEFAULT_PIPELINE_CONFIG.confluence,
    reversalConfirm: DEFAULT_PIPELINE_CONFIG.reversalConfirm,
  };
}

/**
 * Save optimized configuration to JSON
 */
export async function saveOptimizedConfig(config: OptimizedWeights): Promise<void> {
  try {
    const configData: ConfigFile = {
      version: '2.0.0',
      updatedAt: new Date().toISOString(),
      ...config,
    };

    await writeFile(CONFIG_PATH, JSON.stringify(configData, null, 2), 'utf-8');
    logger.info(`Optimized config saved to ${CONFIG_PATH}`);
  } catch (error) {
    logger.error({ error }, 'Failed to save optimized config');
    throw error;
  }
}
