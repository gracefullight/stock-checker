import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PIPELINE_CONFIG, DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import { generateRandomParams, optimizeWithData } from '@/optimization/optimizer-core';
import { loadPipelineConfig, savePipelineConfig } from '@/utils/config-loader';

function candles(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2024, 0, i + 1)),
    open: 100 + i / 10,
    high: 101 + i / 10,
    low: 99 + i / 10,
    close: 100 + i / 10,
    volume: 1_000_000,
  }));
}

describe('optimizer signal-context minimum', () => {
  it.each([200, 209])(
    'rejects %i bars rather than reporting an unevaluated zero-trade optimum',
    (count) => {
      expect(() => optimizeWithData(candles(count), 1)).toThrow(`Insufficient data: ${count} bars`);
    }
  );

  it('builds the 210-bar context but refuses to save a zero-trade optimum', () => {
    expect(() => optimizeWithData(candles(210), 1)).toThrow('with observed trades');
  });
});

describe('leader-pullback optimization family', () => {
  it('keeps setup, trend, cluster, calibration and scoring rules intact across trials', () => {
    const base = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    const original = structuredClone(base);
    for (let i = 0; i < 50; i++) {
      const candidate = generateRandomParams(base);
      const fixed = {
        ...candidate,
        thresholds: base.thresholds,
        institutional: { ...candidate.institutional, weights: base.institutional.weights },
      };
      expect(fixed).toEqual(base);
      expect(Object.values(candidate.institutional.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(
        1
      );
      expect(candidate.thresholds.buy).toBeGreaterThanOrEqual(160);
      expect(candidate.thresholds.buy).toBeLessThanOrEqual(240);
      expect(candidate.thresholds.sell).toBeGreaterThanOrEqual(104);
      expect(candidate.thresholds.sell).toBeLessThanOrEqual(156);
    }
    expect(base).toEqual(original);
  });

  it('rejects a legacy momentum family even for the first baseline-only trial', () => {
    expect(() =>
      optimizeWithData(candles(210), 1, undefined, undefined, DEFAULT_PIPELINE_CONFIG)
    ).toThrow('leader-pullback pipeline');
    expect(() => generateRandomParams(DEFAULT_PIPELINE_CONFIG)).toThrow('leader-pullback pipeline');
  });

  it('keeps the tuned buy threshold below the active buy-score cap', () => {
    const base = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    base.thresholds = { buy: 399, sell: 399 };
    for (let i = 0; i < 50; i++) {
      const candidate = generateRandomParams(base);
      expect(candidate.thresholds.buy).toBeLessThan(400);
      expect(candidate.thresholds.sell).toBeGreaterThanOrEqual(319);
      expect(candidate.thresholds.sell).toBeLessThanOrEqual(479);
    }
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid trial count %s', (trials) => {
    expect(() => optimizeWithData(candles(210), trials)).toThrow('positive integer');
  });

  it('round-trips every optimized field through the full versioned runtime snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stock-checker-optimizer-'));
    const configPath = join(directory, 'optimized_weights.json');
    try {
      const candidate = generateRandomParams();
      await savePipelineConfig(candidate, { configPath });
      const saved = JSON.parse(await readFile(configPath, 'utf-8'));
      expect(saved.version).toBe('3.0.0');
      expect(saved.strategyId).toBe('leader-pullback-v1');
      expect(saved.config).toEqual(candidate);
      expect(await loadPipelineConfig({ configPath })).toEqual(candidate);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
