/**
 * Dynamic Configuration Loader
 * Loads optimized weights and calibration parameters from JSON
 * Falls back to default constants if no optimized config exists
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUY_THRESHOLD, INDICATOR_WEIGHTS, PATTERN_WEIGHTS, SELL_THRESHOLD } from '@/constants';

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
}

export interface ConfigFile extends OptimizedWeights {
  version: string;
  updatedAt: string;
}

/**
 * Load optimized configuration from JSON
 * Falls back to default constants if file doesn't exist
 */
export async function loadOptimizedConfig(): Promise<OptimizedWeights> {
  try {
    const data = await readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(data) as ConfigFile;

    if (config.version !== '1.0.0') {
      console.warn(`Config version mismatch: ${config.version}, using defaults`);
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
    };
  } catch (_error) {
    console.debug('No optimized config found, using defaults');
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
  };
}

/**
 * Save optimized configuration to JSON
 * Called by Python optimizer
 */
export async function saveOptimizedConfig(config: OptimizedWeights): Promise<void> {
  try {
    const configData: ConfigFile = {
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      ...config,
    };

    await writeFile(CONFIG_PATH, JSON.stringify(configData, null, 2), 'utf-8');
    console.info(`Optimized config saved to ${CONFIG_PATH}`);
  } catch (error) {
    console.error('Failed to save optimized config', error);
    throw error;
  }
}
