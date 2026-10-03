import type { StockAnalystReport } from '@stock-checker/core/src/reports/stock-analyst.ts';
import type { ValuationReport } from '@stock-checker/core/src/services/valuation.ts';

export function fixtureValuation(ticker: string): ValuationReport {
  const industry = 'Oil & Gas Equipment & Services';
  return {
    ticker,
    retrievedAt: '2026-10-02T22:00:00.000Z',
    company: {
      trailingPE: 24,
      forwardPE: 18,
      psr: 2,
      currency: 'USD',
      sector: 'Energy',
      industry,
      industryKey: 'oil-gas-equipment-services',
      priceAsOf: '2026-10-02T20:00:00.000Z',
      sourceUrl: `https://finance.yahoo.com/quote/${ticker}/`,
      peReason: null,
      psrReason: null,
    },
    industryComparison: {
      status: 'available',
      medianPE: 20,
      medianPSR: 1,
      peSamples: 3,
      psrSamples: 3,
      peers: [
        { ticker: 'PEER1', trailingPE: 12, psr: 0.6, industry, currency: 'USD' },
        { ticker: 'PEER2', trailingPE: 20, psr: 1, industry, currency: 'USD' },
        { ticker: 'PEER3', trailingPE: 28, psr: 1.4, industry, currency: 'USD' },
      ],
      method: 'Median of positive trailing multiples from matching-industry equities',
      sourceUrl: 'https://finance.yahoo.com/sectors/energy/oil-gas-equipment-services/',
      universe: 'Yahoo top-company peer sample; not the entire industry',
      coverage: {
        candidateCount: 4,
        requestedCount: 3,
        matchingIndustryCount: 3,
        failedRequests: 0,
        excludedIndustryCount: 0,
        excludedNonEquityCount: 0,
        providerCompanyCount: 50,
        peerLimit: 12,
        minimumSamples: 3,
      },
      reason: null,
    },
    relative: { pePremiumPct: 20, psrPremiumPct: 100 },
    warnings: ['Fixture: financial statement publication dates unavailable'],
  };
}

export function fixtureReport(
  ticker: string,
  status: StockAnalystReport['status'] = 'available'
): StockAnalystReport {
  const timestamp = '2026-10-02T22:00:00.000Z';
  return {
    schemaVersion: 1,
    ticker,
    status,
    generatedAt: timestamp,
    dataAsOf: status === 'available' ? '2026-10-02' : null,
    lookbackDays: 2920,
    current:
      status === 'available'
        ? {
            decision: 'HOLD',
            buyScore: 0,
            sellScore: 0,
            gates: {
              trend: { passed: false, regime: 'unknown', strength: 0, reason: 'Fixture' },
              confluence: { passed: false, activeIndicators: 0, totalIndicators: 5, ratio: 0 },
              reversal: { status: 'rejected', trigger: null },
              institutional: {
                score: 0,
                passed: false,
                components: {
                  rsSpy: 0,
                  rsSector: 0,
                  vwap: 0,
                  breakoutVol: 0,
                  liquidity: 0,
                  earnings: 0,
                },
              },
            },
            gateReasons: ['Fixture: no eligible entry'],
            scoreWeights: {
              buy: 0,
              sell: 0,
              hold: 100,
              meaning: 'normalized signal scores, not probabilities of profit',
            },
          }
        : null,
    execution: {
      entry: { status: 'conditional', timing: 'next-session-open', price: null, eligible: false },
      reference: null,
    },
    historical: {
      period: { from: null, to: null },
      method: {
        horizonSessions: 5,
        entry: 'next-session-open',
        fixedHoldExit: 'fifth-session-close',
        roundTripCostBps: 20,
        sampleUnit: 'completed BUY observations; overlap permitted',
        atrBasis: 'signal-session ATR with actual next-session open',
      },
      buySignals: 0,
      excluded: { incomplete: 0, invalidExecution: 0, invalidAtrOrCandles: 0 },
      fixedHold: {
        samples: 0,
        wins: 0,
        winRatePct: null,
        averageNetReturnPct: null,
        rewardRisk: null,
      },
      atrBarriers: {
        samples: 0,
        stopTouched: 0,
        targetTouched: 0,
        bothTouched: 0,
        stopTouchRatePct: null,
        targetTouchRatePct: null,
        stopFirst: 0,
        targetFirst: 0,
        ambiguousFirstTouch: 0,
        neitherTouched: 0,
        gapStopFirst: 0,
        gapTargetFirst: 0,
      },
    },
    analystTargets: {
      ticker,
      retrievedAt: timestamp,
      consensus: null,
      recent: {
        status: 'unavailable',
        source: null,
        retrievedAt: timestamp,
        windowDays: 90,
        count30Days: 0,
        updates: [],
        limit: null,
        reason: 'Fixture: provider unavailable',
      },
      warnings: ['Fixture: optional analyst targets unavailable'],
    },
    valuation: null,
    warnings: ['Fixture: historical success rate unavailable without observations'],
  };
}
