import { describe, expect, it } from 'vitest';
import {
  CONFIGURED_UNIVERSE_NAME,
  CONFIGURED_UNIVERSE_TICKERS,
  TICKER_SECTOR_ETF,
} from '@/constants/tickers';
import {
  buildMarketScreenUniverse,
  classifyCollection,
  configuredUniverseCandidates,
  configuredUniverseProvenance,
  describeUniverseCollection,
  describeUniverseCoverage,
  estimateScanDuration,
  type FinvizScreenProvenance,
  isValidatedUniverse,
  universeWarnings,
} from '@/reports/market-screen-universe';

const finviz: FinvizScreenProvenance = {
  source: 'Finviz',
  url: 'https://finviz.com/screener?v=411&f=ind_stocksonly,ta_sma50_pb&o=-volume',
  filters: ['ind_stocksonly', 'ta_sma50_pb'],
  sourceTotal: 3916,
  capturedAt: '2026-10-06T22:00:01Z',
  completeness: 'partial',
  pages: 1,
  collectionReason: 'candidate-limit',
};

describe('configured validated universe', () => {
  it('is every configured sector-mapped ticker with nothing excluded, in configuration order', () => {
    expect(CONFIGURED_UNIVERSE_TICKERS).toEqual(Object.keys(TICKER_SECTOR_ETF));
    expect(CONFIGURED_UNIVERSE_TICKERS.length).toBeGreaterThan(500);
    expect(new Set(CONFIGURED_UNIVERSE_TICKERS).size).toBe(CONFIGURED_UNIVERSE_TICKERS.length);
    expect(Object.isFrozen(CONFIGURED_UNIVERSE_TICKERS)).toBe(true);
    const copy = configuredUniverseCandidates();
    copy.push('MUTATED');
    expect(CONFIGURED_UNIVERSE_TICKERS).not.toContain('MUTATED');
  });

  it('freezes validated provenance that readers can tell apart from Finviz discovery', () => {
    const provenance = configuredUniverseProvenance(new Date('2026-10-06T22:00:00Z'));
    expect(provenance).toEqual({
      source: 'configured-universe',
      name: CONFIGURED_UNIVERSE_NAME,
      capturedAt: '2026-10-06T22:00:00.000Z',
    });
    const universe = buildMarketScreenUniverse(provenance, ['AAPL', 'MSFT'], 3);
    expect(universe).toEqual({
      source: 'configured-universe',
      validated: true,
      name: CONFIGURED_UNIVERSE_NAME,
      url: null,
      filters: [],
      sourceTotal: 2,
      collectedCount: 2,
      inputCount: 3,
      capturedAt: '2026-10-06T22:00:00.000Z',
      completeness: 'complete',
      overallTotal: null,
      pages: null,
      collectionReason: null,
    });
    expect(isValidatedUniverse(universe)).toBe(true);
    expect(classifyCollection(universe)).toBe('complete');
    expect(describeUniverseCoverage(universe)).toBe('검증 유니버스 2종목');
    expect(describeUniverseCollection(universe)).toBe('검증 유니버스 2종목 · 전체 평가');
    expect(universeWarnings(universe).join(' ')).toMatch(/validated universe/);
    expect(universeWarnings(universe).join(' ')).not.toMatch(/Finviz/);
    expect(() =>
      buildMarketScreenUniverse({ ...provenance, name: 'someone-elses-list' }, ['AAPL'], 1)
    ).toThrow('Unknown configured universe');
    expect(() =>
      buildMarketScreenUniverse({ ...provenance, capturedAt: '2999-01-01T00:00:00Z' }, ['AAPL'], 1)
    ).toThrow('capturedAt');
  });
});

describe('Finviz candidate universe', () => {
  it('keeps the exact validated shape and labels the lane unvalidated', () => {
    const universe = buildMarketScreenUniverse(finviz, ['OII', 'AAPL'], 2);
    expect(universe).toEqual({
      source: 'finviz-candidates',
      validated: false,
      url: finviz.url,
      filters: ['ind_stocksonly', 'ta_sma50_pb'],
      sourceTotal: 3916,
      collectedCount: 2,
      inputCount: 2,
      capturedAt: '2026-10-06T22:00:01.000Z',
      completeness: 'partial',
      overallTotal: null,
      pages: 1,
      collectionReason: 'candidate-limit',
    });
    expect(isValidatedUniverse(universe)).toBe(false);
    expect(describeUniverseCoverage(universe)).toBe('Finviz 후보 2/3916');
    expect(describeUniverseCollection(universe)).toBe(
      'Finviz 후보 수집 2/3916 · 상한 수집 · 미검증 유니버스'
    );
    expect(universeWarnings(universe)).toHaveLength(4);
    expect(universeWarnings(universe)[2]).toMatch(/unvalidated discovery universe/);
  });

  it('separates a by-design cap from a collection failure', () => {
    expect(
      classifyCollection({ completeness: 'partial', collectionReason: 'candidate-limit' })
    ).toBe('capped');
    expect(classifyCollection({ completeness: 'partial', collectionReason: 'page-limit' })).toBe(
      'capped'
    );
    expect(classifyCollection({ completeness: 'partial', collectionReason: 'deadline' })).toBe(
      'partial'
    );
    expect(classifyCollection({ completeness: 'partial', collectionReason: null })).toBe('partial');
    expect(classifyCollection({ completeness: 'complete', collectionReason: null })).toBe(
      'complete'
    );
    expect(
      describeUniverseCollection(
        buildMarketScreenUniverse({ ...finviz, collectionReason: 'deadline' }, ['OII'], 1)
      )
    ).toContain('부분 수집');
    // Legacy saved jobs predate the reason field.
    expect(classifyCollection({ completeness: 'partial' } as never)).toBe('partial');
    expect(() =>
      buildMarketScreenUniverse({ ...finviz, collectionReason: 'made-up' as never }, ['OII'], 1)
    ).toThrow('collectionReason');
  });

  it('rejects missing or foreign provenance with the public error message', () => {
    expect(() => buildMarketScreenUniverse(undefined, ['OII'], 1)).toThrow(
      'Valid Finviz provenance is required'
    );
    expect(() => buildMarketScreenUniverse({ source: 'Yahoo' } as never, ['OII'], 1)).toThrow(
      'Valid Finviz provenance is required'
    );
  });
});

describe('scan duration estimate', () => {
  it('uses the two-worker pacing and provider latency to bound a budget', () => {
    expect(estimateScanDuration(555)).toMatchObject({
      candidates: 555,
      concurrency: 2,
      minIntervalMs: 1_000,
      perTickerMs: 2_500,
      estimatedMs: 278 * 2_500,
    });
    expect(estimateScanDuration(555).estimatedMs).toBeLessThan(20 * 60_000);
    expect(estimateScanDuration(200, { minIntervalMs: 5_000 }).estimatedMs).toBe(100 * 5_000);
    expect(estimateScanDuration(0).estimatedMs).toBe(0);
  });
});
