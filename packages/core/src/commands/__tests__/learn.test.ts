import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { learn } from '@/commands/learn';
import { fitPlattScaling } from '@/optimization/calibrator';
import { getHistoricalPrices } from '@/services/data-fetcher';

const mocks = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  stop: vi.fn(),
  optimize: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ on: (_event: string, callback: (code: number) => void) => callback(0) })),
}));
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));
vi.mock('pino', () => ({ default: () => mocks.logger }));
vi.mock('@/services/data-fetcher', () => ({ getHistoricalPrices: vi.fn() }));
vi.mock('@/optimization/calibrator', () => ({ fitPlattScaling: vi.fn() }));
vi.mock('@/optimization/optimizer', () => ({
  Optimizer: class {
    optimize = mocks.optimize;
  },
}));
vi.mock('@/utils/config-loader', () => ({ saveOptimizedConfig: vi.fn() }));
vi.mock('@/ui/prompts', () => ({
  p: {
    intro: vi.fn(),
    outro: vi.fn(),
    spinner: () => ({ start: vi.fn(), stop: mocks.stop, message: vi.fn() }),
  },
  pc: {
    bgCyan: (text: string) => text,
    black: (text: string) => text,
    bold: (text: string) => text,
    red: (text: string) => text,
    green: (text: string) => text,
  },
}));

const dailyRows = ['06', '07', '08', '09', '10', '13'].map((day) => ({
  date: new Date(`2025-01-${day}T00:00:00.000Z`),
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  adjClose: 100,
  volume: 1_000,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.readdirSync).mockReturnValue(['predictions_20250106.json'] as never);
  vi.mocked(fs.readFileSync).mockReturnValue(
    JSON.stringify([{ date: '2025-01-06', ticker: 'AAPL', opinion: 'BUY', close: 200, score: 100 }])
  );
  vi.mocked(getHistoricalPrices).mockResolvedValue(dailyRows);
  vi.mocked(fitPlattScaling).mockReturnValue({ slope: 0.01, intercept: -1, brierScore: 0.2 });
  mocks.optimize.mockResolvedValue({
    symbol: 'AAPL',
    bestValue: 1,
    bestParams: { calibration: { slope: 0.01, intercept: -1 } },
  });
});

describe('learn outcome data and fitting', () => {
  it('evaluates daily provider history without reading sparse outcome CSVs', async () => {
    await learn();

    expect(getHistoricalPrices).toHaveBeenCalledOnce();
    expect(fs.readdirSync).toHaveBeenCalledOnce();
    expect(fs.readdirSync).toHaveBeenCalledWith(expect.stringContaining('data/feedback'));
    expect(fs.readFileSync).toHaveBeenCalledOnce();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('accuracy_metrics.json'),
      expect.stringContaining('"correctPredictions": 0')
    );
    expect(fitPlattScaling).toHaveBeenCalledWith([100], [false]);
  });

  it('reports unavailable accuracy and skips metric/fitting writes after provider failure', async () => {
    vi.mocked(getHistoricalPrices).mockRejectedValue(new Error('Provider unavailable'));

    await learn();

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      { ticker: 'AAPL', reason: 'fetch-failed' },
      expect.stringContaining('excluded from evaluation')
    );
    expect(mocks.stop).toHaveBeenCalledWith(
      'No matched outcomes; directional accuracy unavailable'
    );
    expect(fs.writeFileSync).not.toHaveBeenCalledWith(
      expect.stringContaining('accuracy_metrics.json'),
      expect.anything()
    );
    expect(fs.writeFileSync).not.toHaveBeenCalledWith(
      expect.stringContaining('calibration_params.json'),
      expect.anything()
    );
    expect(fitPlattScaling).not.toHaveBeenCalled();
  });

  it.each([
    null,
    'Infinity',
  ])('skips fitting and saving when the matched score is %s', async (score) => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([{ date: '2025-01-06', ticker: 'AAPL', opinion: 'BUY', close: 200, score }])
    );

    await learn();

    expect(fitPlattScaling).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalledWith(
      expect.stringContaining('calibration_params.json'),
      expect.anything()
    );
    expect(mocks.stop).toHaveBeenCalledWith('Score mapping skipped: no finite matched scores');
  });

  it('skips a numeric nonfinite score parsed from an overflowing JSON number', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      '[{"date":"2025-01-06","ticker":"AAPL","opinion":"BUY","close":200,"score":1e309}]'
    );

    await learn();

    expect(fitPlattScaling).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalledWith(
      expect.stringContaining('calibration_params.json'),
      expect.anything()
    );
  });
});
