import { beforeEach, describe, expect, it, vi } from 'vitest';
import { optimize } from '@/commands/optimize';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';

const mocks = vi.hoisted(() => ({ optimize: vi.fn(), saveConfig: vi.fn(), writeFile: vi.fn() }));
vi.mock('pino', () => ({ default: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock('node:fs', () => ({
  existsSync: () => true,
  mkdirSync: vi.fn(),
  writeFileSync: mocks.writeFile,
}));
vi.mock('@/optimization/optimizer', () => ({
  Optimizer: class {
    optimize = mocks.optimize;
  },
}));
vi.mock('@/utils/config-loader', () => ({
  CONFIG_PATH: '/test-repository/data/config/optimized_weights.json',
  savePipelineConfig: mocks.saveConfig,
}));

describe('optimization command persistence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves the entire optimized pipeline, including the leader and pullback rules', async () => {
    const config = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    config.thresholds = { buy: 190, sell: 140 };
    mocks.optimize.mockResolvedValue({ bestValue: 0.25, bestParams: config });
    mocks.saveConfig.mockResolvedValue(undefined);

    await optimize('AAPL', { trials: '2' });
    expect(mocks.saveConfig).toHaveBeenCalledOnce();
    expect(mocks.saveConfig).toHaveBeenCalledWith(config);
    expect(mocks.saveConfig.mock.calls[0][0].qualityGate).toEqual(config.qualityGate);
    expect(mocks.saveConfig.mock.calls[0][0].institutional).toEqual(config.institutional);
    expect(JSON.parse(mocks.writeFile.mock.calls[0][1]).bestParams).toEqual(config);
  });
});
