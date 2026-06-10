import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUND_TRIP_COST_PCT } from '@/constants';
import { type BacktestSignal, buildEquityCurve, measure5DayWinRate } from '@/optimization/engine';

function makeSignal(overrides: Partial<BacktestSignal> = {}): BacktestSignal {
  return {
    date: new Date('2024-01-02'),
    ticker: 'TEST',
    close: 100,
    decision: 'BUY',
    score: 300,
    regime: 'uptrend',
    confluenceRatio: 0.5,
    rsSpy: 0.5,
    rsSector: 0.5,
    vwap: 0.5,
    breakoutVol: 0.5,
    rsi: 50,
    stochK: 50,
    williamsR: -50,
    atr: 2,
    volumeRatio: 1,
    trendStrength: 0.5,
    sma50dist: 0,
    sma200dist: 0,
    rsiDelta: 0,
    priceDelta: 0,
    ibs: 0.5,
    rsi2cumul: 50,
    atrDistance: 0,
    consecutiveOversold: 0,
    ...overrides,
  };
}

/** 10 daily bars starting 2024-01-02, all closes given. */
function makePrices(closes: number[]): { date: Date; close: number }[] {
  return closes.map((close, i) => {
    const date = new Date('2024-01-02');
    date.setDate(date.getDate() + i);
    return { date, close };
  });
}

describe('measure5DayWinRate transaction costs', () => {
  it('deducts the round-trip cost from every trade return', () => {
    // 100 → 102 over 5 bars: +2% gross.
    const prices = makePrices([100, 101, 101, 101, 101, 102, 102, 102, 102, 102]);
    const r = measure5DayWinRate([makeSignal()], new Map([['TEST', prices]]));
    expect(r.totalSignals).toBe(1);
    expect(r.avgReturn).toBeCloseTo(2 - DEFAULT_ROUND_TRIP_COST_PCT, 10);
  });

  it('counts a trade whose gross gain is smaller than the cost as a LOSS', () => {
    // 100 → 100.05 over 5 bars: +0.05% gross, below the 0.10% round-trip cost.
    const prices = makePrices([100, 100, 100, 100, 100, 100.05, 100.05, 100.05, 100.05, 100.05]);
    const r = measure5DayWinRate([makeSignal()], new Map([['TEST', prices]]));
    expect(r.totalSignals).toBe(1);
    expect(r.wins).toBe(0);
    expect(r.winRate5d).toBe(0);
    expect(r.avgReturn).toBeLessThan(0);
  });

  it('treats the same marginal trade as a WIN when cost is explicitly 0', () => {
    const prices = makePrices([100, 100, 100, 100, 100, 100.05, 100.05, 100.05, 100.05, 100.05]);
    const r = measure5DayWinRate([makeSignal()], new Map([['TEST', prices]]), 0);
    expect(r.wins).toBe(1);
    expect(r.avgReturn).toBeCloseTo(0.05, 10);
  });
});

describe('buildEquityCurve transaction costs', () => {
  it('compounds net-of-cost returns', () => {
    // 100 → 110 over 5 bars: +10% gross per trade.
    const prices = makePrices([100, 102, 104, 106, 108, 110, 110, 110, 110, 110]);
    const r = buildEquityCurve([makeSignal()], prices, 5, 10_000);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].returnPct).toBeCloseTo(10 - DEFAULT_ROUND_TRIP_COST_PCT, 10);
    expect(r.totalReturn).toBeCloseTo(10 - DEFAULT_ROUND_TRIP_COST_PCT, 10);
  });
});
