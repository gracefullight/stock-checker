import type { PipelineConfig } from '@stock-checker/core/src/types';
import { loadPipelineConfig } from '@stock-checker/core/src/utils/config-loader';
import { analyzeTicker } from '@/lib/analyze';
import { cacheStore, MINUTE, ttlUnlessEmpty } from '@/lib/cache';

// Daily-candle analysis tolerates minutes of staleness.
const ANALYZE_TTL = 10 * MINUTE;

const cache = cacheStore.define(
  'analyze',
  {
    // Include the complete strategy snapshot so saving new settings invalidates
    // stale decisions while unchanged requests still deduplicate market calls.
    ttl: ttlUnlessEmpty(ANALYZE_TTL, (v) => v == null),
  },
  ({
    ticker,
    fearGreed,
    pipelineConfig,
  }: {
    ticker: string;
    fearGreed: number | null;
    pipelineConfig: PipelineConfig;
  }) => analyzeTicker(ticker, fearGreed, { pipelineConfig })
);

export async function cachedAnalyzeTicker(ticker: string, fearGreed: number | null) {
  const pipelineConfig = await loadPipelineConfig();
  return cache.analyze({ ticker, fearGreed, pipelineConfig });
}
