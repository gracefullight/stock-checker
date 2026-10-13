import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import { strategyConfigFingerprint } from '@/reports/strategy-validation';
import type { PipelineConfig } from '@/types';
import {
  CANONICAL_STRATEGY_ID,
  CONFIG_PATH,
  cloneCanonicalPipelineConfig,
  explainPipelineConfigRejection,
  loadPipelineConfig,
  PIPELINE_CONFIG_VERSION,
  PipelineConfigError,
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

/** The 2026-10-06 measurement fingerprint (docs/validation/leader-pullback-2026-10-06.md). */
const VALIDATED_CONFIG_SHA256 = '9d15fbdaa4a0b607e6de440bf05d6584d3b855c2f93a53de5854b3a2fa5338cb';

describe('shared leader-pullback pipeline configuration', () => {
  it('keeps the default configuration identical to the validated fingerprint', async () => {
    expect(strategyConfigFingerprint(DEFAULT_QUALITY_PIPELINE_CONFIG)).toBe(
      VALIDATED_CONFIG_SHA256
    );
    const tracked = JSON.parse(
      await readFile(
        fileURLToPath(
          new URL(
            '../../../../docs/validation/leader-pullback-2026-10-06.config.json',
            import.meta.url
          )
        ),
        'utf-8'
      )
    ) as { config: PipelineConfig };
    expect(strategyConfigFingerprint(tracked.config)).toBe(VALIDATED_CONFIG_SHA256);
    // Optional cluster research knobs are absent from the default object.
    expect(DEFAULT_QUALITY_PIPELINE_CONFIG.clusterFilter).toEqual({ enabled: true, minGapDays: 5 });
  });

  it('uses complete canonical defaults for the implicit file when it is missing or malformed', async () => {
    expect(await loadPipelineConfig({ configPath, strict: false })).toEqual(
      DEFAULT_QUALITY_PIPELINE_CONFIG
    );
    await writeFile(configPath, '{ broken json');
    expect(await loadPipelineConfig({ configPath, strict: false })).toEqual(
      DEFAULT_QUALITY_PIPELINE_CONFIG
    );
    // The implicit repository path is lenient by default.
    expect(await loadPipelineConfig()).toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG);
  });

  it('fails an explicit config path that is missing, malformed, or invalid and names the rule', async () => {
    await expect(loadPipelineConfig({ configPath })).rejects.toThrow(PipelineConfigError);
    await expect(loadPipelineConfig({ configPath })).rejects.toThrow('file could not be read');
    await writeFile(configPath, '{ broken json');
    await expect(loadPipelineConfig({ configPath })).rejects.toThrow('file is not valid JSON');
    const config = cloneCanonicalPipelineConfig();
    config.qualityGate!.requireBelowSma50 = false;
    await writeFile(configPath, JSON.stringify(snapshot(config)));
    const error = await loadPipelineConfig({ configPath }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PipelineConfigError);
    expect((error as PipelineConfigError).rule).toBe('qualityGate.requireBelowSma50 must be true');
    expect((error as PipelineConfigError).configPath).toBe(configPath);
    await writeFile(configPath, JSON.stringify({ ...snapshot(config), version: '2.0.0' }));
    await expect(loadPipelineConfig({ configPath })).rejects.toThrow('version must be 3.0.0');
  });

  it.each([undefined, '1.0.0', '2.0.0'])(
    'ignores legacy version %s without mixing its weights or thresholds into the strategy',
    async (version) => {
      await writeFile(
        configPath,
        JSON.stringify({ version, weights: { rsi: 999 }, thresholds: { buy: 777, sell: 666 } })
      );
      expect(await loadPipelineConfig({ configPath, strict: false })).toEqual(
        DEFAULT_QUALITY_PIPELINE_CONFIG
      );
      await expect(loadPipelineConfig({ configPath })).rejects.toThrow(PipelineConfigError);
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

  it('accepts the leader-pullback strategy alias and normalizes it on load', async () => {
    const config = cloneCanonicalPipelineConfig();
    config.strategy = 'leader-pullback';
    expect(explainPipelineConfigRejection(config)).toBeNull();
    await writeFile(configPath, JSON.stringify(snapshot(config)));
    const loaded = await loadPipelineConfig({ configPath });
    expect(loaded.strategy).toBe('institutional');
    expect(loaded).toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG);
  });

  it('accepts optional cluster research options and rejects unknown values', async () => {
    const config = cloneCanonicalPipelineConfig();
    config.clusterFilter.consume = 'buys-only';
    config.clusterFilter.gapUnit = 'sessions';
    expect(explainPipelineConfigRejection(config)).toBeNull();
    await writeFile(configPath, JSON.stringify(snapshot(config)));
    expect((await loadPipelineConfig({ configPath })).clusterFilter).toEqual({
      enabled: true,
      minGapDays: 5,
      consume: 'buys-only',
      gapUnit: 'sessions',
    });
    expect(strategyConfigFingerprint(config)).not.toBe(VALIDATED_CONFIG_SHA256);
    (config.clusterFilter as { consume: string }).consume = 'everything';
    expect(explainPipelineConfigRejection(config)).toContain('clusterFilter.consume');
    config.clusterFilter.consume = 'all-setups';
    (config.clusterFilter as { gapUnit: string }).gapUnit = 'weeks';
    expect(explainPipelineConfigRejection(config)).toContain('clusterFilter.gapUnit');
  });

  it('does not share nested defaults or loaded snapshots between callers', async () => {
    const first = await loadPipelineConfig({ configPath, strict: false });
    first.institutional.weights.rsSpy = 999;
    first.qualityGate!.ibsMax = 0.9;
    first.gradientRanges.rsi.max = 999;
    expect(cloneCanonicalPipelineConfig()).toEqual(DEFAULT_QUALITY_PIPELINE_CONFIG);
    expect(await loadPipelineConfig({ configPath, strict: false })).toEqual(
      DEFAULT_QUALITY_PIPELINE_CONFIG
    );

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
      'qualityGate.enabled must be true',
    ],
    [
      'missing leader filter',
      (config: PipelineConfig) => {
        delete config.qualityGate!.rsMin;
      },
      'qualityGate.rsMin must be a finite number',
    ],
    [
      'another strategy',
      (config: PipelineConfig) => {
        config.strategy = 'mean-reversion';
      },
      "strategy must be 'institutional' (alias 'leader-pullback')",
    ],
    [
      'another trend source',
      (config: PipelineConfig) => {
        config.trendGate.source = 'sma';
      },
      "trendGate.source must be 'gaussian'",
    ],
    [
      'missing full section',
      (config: PipelineConfig) => {
        delete (config as Partial<PipelineConfig>).clusterFilter;
      },
      'clusterFilter must be an object',
    ],
    [
      'negative flow weight',
      (config: PipelineConfig) => {
        config.institutional.weights.rsSpy = -1;
      },
      'institutional.weights must be non-negative',
    ],
    [
      'nonfinite threshold',
      (config: PipelineConfig) => {
        config.thresholds.buy = Number.NaN;
      },
      'thresholds.buy must be a finite number',
    ],
  ] as const)('rejects a snapshot with %s', async (_name, tamper, rule) => {
    const config = cloneCanonicalPipelineConfig();
    tamper(config);
    expect(explainPipelineConfigRejection(config)).toBe(rule);
    await expect(savePipelineConfig(config, { configPath })).rejects.toThrow(rule);
    await writeFile(configPath, JSON.stringify(snapshot(config)));
    expect(await loadPipelineConfig({ configPath, strict: false })).toEqual(
      DEFAULT_QUALITY_PIPELINE_CONFIG
    );
    await expect(loadPipelineConfig({ configPath })).rejects.toThrow(rule);
  });

  it('rejects incompatible strategy provenance and incomplete configuration versions', async () => {
    await writeFile(
      configPath,
      JSON.stringify({ ...snapshot(cloneCanonicalPipelineConfig()), strategyId: 'momentum-v2' })
    );
    expect(await loadPipelineConfig({ configPath, strict: false })).toEqual(
      DEFAULT_QUALITY_PIPELINE_CONFIG
    );
    await expect(loadPipelineConfig({ configPath })).rejects.toThrow(
      `strategyId must be ${CANONICAL_STRATEGY_ID}`
    );
    await writeFile(configPath, JSON.stringify(snapshot({ thresholds: { buy: 230, sell: 140 } })));
    expect(await loadPipelineConfig({ configPath, strict: false })).toEqual(
      DEFAULT_QUALITY_PIPELINE_CONFIG
    );
  });

  it('routes legacy-config diagnostics to stderr without contaminating MCP JSON-RPC stdout', async () => {
    await writeFile(configPath, JSON.stringify({ version: '2.0.0', weights: { rsi: 999 } }));
    const modulePath = fileURLToPath(new URL('./config-loader.ts', import.meta.url));
    const program = `const { loadPipelineConfig } = await import(${JSON.stringify(modulePath)});
await loadPipelineConfig({ configPath: ${JSON.stringify(configPath)}, strict: false });
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
