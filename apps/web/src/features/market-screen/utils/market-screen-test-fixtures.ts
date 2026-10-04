import type { MarketScreenJob, MarketScreenJobSnapshot, MarketScreenResultKind } from '@/lib/api';

export const FIRST_MARKET_JOB = '11111111-1111-4111-8111-111111111111';
export const SECOND_MARKET_JOB = '22222222-2222-4222-8222-222222222222';

export function fixtureMarketScreenJob(
  id = FIRST_MARKET_JOB,
  status: MarketScreenJob['status'] = 'paused'
): MarketScreenJob {
  const finished = ['completed', 'partial', 'unavailable'].includes(status);
  return {
    schemaVersion: 1,
    id,
    status,
    createdAt: '2026-10-03T12:00:00.000Z',
    updatedAt: '2026-10-03T12:01:00.000Z',
    startedAt: null,
    finishedAt: finished ? '2026-10-03T12:01:00.000Z' : null,
    pauseReason: status === 'paused' ? 'Saved job is paused.' : null,
    universe: {
      source: 'finviz-candidates',
      url: 'https://finviz.com/screener?v=411&f=ind_stocksonly,ta_sma50_pb',
      filters: ['ind_stocksonly', 'ta_sma50_pb'],
      sourceTotal: 3,
      collectedCount: 2,
      inputCount: 2,
      capturedAt: '2026-10-03T11:00:00.000Z',
      completeness: 'partial',
      overallTotal: 11702,
      pages: 1,
    },
    criteria: {
      decision: 'BUY',
      lookbackDays: 730,
      engine: 'Offline fixture',
      concurrency: 2,
      minIntervalMs: 1000,
    },
    progress: {
      total: 2,
      analyzed: finished ? 2 : 1,
      unavailable: 0,
      pending: finished ? 0 : 1,
      inFlight: 0,
      matched: 1,
      excluded: finished ? 1 : 0,
    },
    warnings: ['Only the frozen supplied candidate list is covered.'],
  };
}

export function fixtureMarketScreenSnapshot(
  id = FIRST_MARKET_JOB,
  kind: MarketScreenResultKind = 'matches',
  status: MarketScreenJob['status'] = 'paused'
): MarketScreenJobSnapshot {
  const job = fixtureMarketScreenJob(id, status);
  if (job.progress.excluded) job.progress.analyzed = 2;
  return {
    job,
    page: {
      kind,
      offset: 0,
      limit: 20,
      total: 1,
      hasMore: false,
      items:
        kind === 'unavailable'
          ? [{ ticker: 'MISSING', reason: 'Completed-session data unavailable.', attempts: 1 }]
          : [
              {
                ticker: kind === 'excluded' ? 'BLOCKED' : 'AA',
                dataAsOf: '2026-10-02',
                decision: kind === 'excluded' ? 'HOLD' : 'BUY',
                score: 250,
                buyScore: 250,
                sellScore: 5,
                gates: {
                  trend: { passed: true, regime: 'uptrend', strength: 100, reason: 'Upward trend' },
                  confluence: {
                    passed: true,
                    activeIndicators: 5,
                    totalIndicators: 6,
                    ratio: 5 / 6,
                  },
                  reversal: { status: 'confirmed', trigger: 'both' },
                  institutional: {
                    score: 0.8,
                    passed: true,
                    components: {
                      rsSpy: 1,
                      rsSector: 1,
                      vwap: 1,
                      breakoutVol: 1,
                      liquidity: 1,
                      earnings: 0,
                    },
                  },
                },
                gateReasons: ['Completed-session engine evidence.'],
                rsi: 50,
                sector: null,
                execution: {
                  entry: {
                    status: 'conditional',
                    timing: 'next-session-open',
                    price: null,
                    eligible: kind !== 'excluded',
                  },
                  reference: {
                    basis: 'latest-completed-close',
                    price: 100,
                    atr: 2,
                    stopLoss: 97,
                    takeProfit: 106,
                    trailingStop: 97,
                    trailingStart: 101,
                  },
                },
              },
            ],
    },
  };
}
