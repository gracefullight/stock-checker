import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@stock-checker/core/src/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analyze', () => ({ analyzeTicker: vi.fn() }));
vi.mock('@stock-checker/core/src/utils/config-loader', () => ({ loadPipelineConfig: vi.fn() }));

import { loadPipelineConfig } from '@stock-checker/core/src/utils/config-loader';
import { analyzeTicker } from '@/lib/analyze';
import { clearCache } from '@/lib/cache';
import { cachedAnalyzeTicker } from '@/lib/cached/analyze';

const mockedAnalyzeTicker = vi.mocked(analyzeTicker);
const mockedLoadPipelineConfig = vi.mocked(loadPipelineConfig);

describe('cached ticker analysis', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mockedLoadPipelineConfig.mockResolvedValue(structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG));
    await clearCache();
  });

  it('deduplicates calls with the same ticker and sentiment', async () => {
    const result = { ticker: 'AAPL', fearGreed: 50 };
    mockedAnalyzeTicker.mockResolvedValue(result as never);

    const results = await Promise.all([
      cachedAnalyzeTicker('AAPL', 50),
      cachedAnalyzeTicker('AAPL', 50),
    ]);

    expect(results).toEqual([result, result]);
    expect(mockedAnalyzeTicker).toHaveBeenCalledTimes(1);
  });

  it.each([null, 30])('reanalyzes when sentiment changes from %s', async (previousSentiment) => {
    const previous = { ticker: 'AAPL', fearGreed: previousSentiment };
    const current = { ticker: 'AAPL', fearGreed: 70 };
    mockedAnalyzeTicker
      .mockResolvedValueOnce(previous as never)
      .mockResolvedValueOnce(current as never);

    expect(await cachedAnalyzeTicker('AAPL', previousSentiment)).toEqual(previous);
    expect(await cachedAnalyzeTicker('AAPL', 70)).toEqual(current);
    expect(mockedAnalyzeTicker).toHaveBeenNthCalledWith(2, 'AAPL', 70, {
      pipelineConfig: DEFAULT_QUALITY_PIPELINE_CONFIG,
    });
  });

  it('invalidates a cached decision immediately when the active strategy changes', async () => {
    const previous = { ticker: 'AAPL', opinion: 'BUY' };
    const current = { ticker: 'AAPL', opinion: 'HOLD' };
    mockedAnalyzeTicker
      .mockResolvedValueOnce(previous as never)
      .mockResolvedValueOnce(current as never);
    expect(await cachedAnalyzeTicker('AAPL', 50)).toEqual(previous);

    const updated = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    updated.thresholds.buy = 250;
    mockedLoadPipelineConfig.mockResolvedValue(updated);

    expect(await cachedAnalyzeTicker('AAPL', 50)).toEqual(current);
    expect(mockedAnalyzeTicker).toHaveBeenNthCalledWith(2, 'AAPL', 50, { pipelineConfig: updated });
    expect(await cachedAnalyzeTicker('AAPL', 50)).toEqual(current);
    expect(mockedAnalyzeTicker).toHaveBeenCalledTimes(2);
  });
});
