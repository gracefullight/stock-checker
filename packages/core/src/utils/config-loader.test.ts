import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import type { PipelineConfig } from '@/types';
import {
  CANONICAL_STRATEGY_ID,
  CONFIG_PATH,
  cloneCanonicalPipelineConfig,
  loadPipelineConfig,
  PIPELINE_CONFIG_VERSION,
  savePipelineConfig,
} from '@/utils/config-loader';

let directory: string;
let configPath: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'stock-checker-config-'));
  configPath = join(directory, 'optimized_weights.json');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function snapshot(config: unknown) {
  return {
    version: PIPELINE_CONFIG_VERSION,
    strategyId: CANONICAL_STRATEGY_ID,
    updatedAt: '2026-10-06T00:00:00.000Z',
    config,
  };
}

describe('shared leader-pullback pipeline configuration', () => {
  it('uses complete canonical defaults when the file is missing or malformed', async () => {
    expect(await loadPipelineConfig({ configPath })).toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG);
    await writeFile(configPath, '{ broken json');
    expect(await loadPipelineConfig({ configPath })).toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG);
  });

  it.each([undefined, '1.0.0', '2.0.0'])(
    'ignores legacy version %s without mixing its weights or thresholds into the strategy',
    async (version) => {
      await writeFile(
        configPath,
        JSON.stringify({ version, weights: { rsi: 999 }, thresholds: { buy: 777, sell: 666 } })
      );
      expect(await loadPipelineConfig({ configPath })).toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG);
    }
  );

  it('persists and reloads all gates, weights, ranges and calibration as one versioned snapshot', async () => {
    const config = cloneCanonicalPipelineConfig();
    config.thresholds = { buy: 230, sell: 140 };
    config.institutional.weights = {
      rsSpy: 0.4,
      rsSector: 0.2,
      vwap: 0.15,
      breakoutVol: 0.15,
      liquidity: 0.07,
      earnings: 0.03,
    };
    await savePipelineConfig(config, { configPath });
    expect(await loadPipelineConfig({ configPath })).toEqual(config);
    expect(JSON.parse(await readFile(configPath, 'utf-8'))).toEqual({
      version: PIPELINE_CONFIG_VERSION,
      strategyId: CANONICAL_STRATEGY_ID,
      updatedAt: expect.any(String),
      config,
    });
    expect(await readdir(directory)).toEqual(['optimized_weights.json']);
  });

  it('does not share nested defaults or loaded snapshots between callers', async () => {
    const first = await loadPipelineConfig({ configPath });
    first.institutional.weights.rsSpy = 999;
    first.qualityGate!.ibsMax = 0.9;
    first.gradientRanges.rsi.max = 999;
    expect(cloneCanonicalPipelineConfig()).toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG);
    expect(await loadPipelineConfig({ configPath })).toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG);

    await savePipelineConfig(cloneCanonicalPipelineConfig(), { configPath });
    const loaded = await loadPipelineConfig({ configPath });
    loaded.thresholds.buy = 300;
    expect(await loadPipelineConfig({ configPath })).toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG);
  });

  it('resolves the default file from the repository root independently of the caller working directory', async () => {
    const callerDirectory = process.cwd();
    try {
      process.chdir(directory);
      expect(CONFIG_PATH).toBe(
        fileURLToPath(new URL('../../../../data/config/optimized_weights.json', import.meta.url))
      );
      expect(CONFIG_PATH.startsWith(directory)).toBe(false);
      await savePipelineConfig(cloneCanonicalPipelineConfig(), { configPath });
      expect(await loadPipelineConfig({ configPath })).toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG);
    } finally {
      process.chdir(callerDirectory);
    }
  });

  it.each([
    [
      'disabled pullback gate',
      (config: PipelineConfig) => {
        config.qualityGate!.enabled = false;
      },
    ],
    [
      'missing leader filter',
      (config: PipelineConfig) => {
        delete config.qualityGate!.rsMin;
      },
    ],
    [
      'another strategy',
      (config: PipelineConfig) => {
        config.strategy = 'mean-reversion';
      },
    ],
    [
      'another trend source',
      (config: PipelineConfig) => {
        config.trendGate.source = 'sma';
      },
    ],
    [
      'missing full section',
      (config: PipelineConfig) => {
        delete (config as Partial<PipelineConfig>).clusterFilter;
      },
    ],
    [
      'negative flow weight',
      (config: PipelineConfig) => {
        config.institutional.weights.rsSpy = -1;
      },
    ],
    [
      'nonfinite threshold',
      (config: PipelineConfig) => {
        config.thresholds.buy = Number.NaN;
      },
    ],
  ] as const)('rejects a snapshot with %s', async (_name, tamper) => {
    const config = cloneCanonicalPipelineConfig();
    tamper(config);
    await expect(savePipelineConfig(config, { configPath })).rejects.toThrow(TypeError);
    await writeFile(configPath, JSON.stringify(snapshot(config)));
    expect(await loadPipelineConfig({ configPath })).toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG);
  });

  it('rejects incompatible strategy provenance and incomplete configuration versions', async () => {
    await writeFile(
      configPath,
      JSON.stringify({ ...snapshot(cloneCanonicalPipelineConfig()), strategyId: 'momentum-v2' })
    );
    expect(await loadPipelineConfig({ configPath })).toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG);
    await writeFile(configPath, JSON.stringify(snapshot({ thresholds: { buy: 230, sell: 140 } })));
    expect(await loadPipelineConfig({ configPath })).toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG);
  });

  it('routes legacy-config diagnostics to stderr without contaminating MCP JSON-RPC stdout', async () => {
    await writeFile(configPath, JSON.stringify({ version: '2.0.0', weights: { rsi: 999 } }));
    const modulePath = fileURLToPath(new URL('./config-loader.ts', import.meta.url));
    const program = `const { loadPipelineConfig } = await import(${JSON.stringify(modulePath)});
await loadPipelineConfig({ configPath: ${JSON.stringify(configPath)} });
process.stdout.write('rpc-ready\\n');`;
    const { stdout, stderr } = await promisify(execFile)('bun', ['--eval', program], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      timeout: 8_000,
      maxBuffer: 64 * 1024,
    });
    expect(stdout).toBe('rpc-ready\n');
    expect(stderr).toContain('Ignoring legacy or incompatible pipeline config');
  });
});

import { execFile } from 'node:child_process';
