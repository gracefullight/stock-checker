import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analyze', () => ({ analyzeTicker: vi.fn() }));

import { analyzeTicker } from '@/lib/analyze';
import { clearCache } from '@/lib/cache';
import { cachedAnalyzeTicker } from '@/lib/cached/analyze';

const mockedAnalyzeTicker = vi.mocked(analyzeTicker);

describe('cached ticker analysis', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
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
    expect(mockedAnalyzeTicker).toHaveBeenNthCalledWith(2, 'AAPL', 70);
  });
});
