import { describe, expect, it } from 'vitest';
import type { BacktestSignal, Candle } from '@/optimization/engine';
import { observeAtrBarriers, summarizeHistoricalOutcomes } from '@/reports/historical-outcomes';

function candles(): Candle[] {
  return ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-05'].map(
    (date) => ({
      date: new Date(date),
      open: 100,
      high: 102,
      low: 98,
      close: 100.05,
      volume: 1_000,
    })
  );
}

function buy(bar: Candle, atr = 2): BacktestSignal {
  return {
    date: bar.date,
    ticker: 'TEST',
    close: bar.close,
    decision: 'BUY',
    score: 100,
    regime: 'uptrend',
    confluenceRatio: 1,
    rsSpy: 1,
    rsSector: 1,
    vwap: 1,
    breakoutVol: 1,
    rsi: 50,
    stochK: 50,
    williamsR: -50,
    atr,
    volumeRatio: 1,
    trendStrength: 100,
    sma50dist: 0,
    sma200dist: 0,
    rsiDelta: 0,
    priceDelta: 0,
    ibs: 0.5,
    rsi2cumul: 100,
    atrDistance: 0,
    consecutiveOversold: 0,
  };
}

describe('historical report outcomes', () => {
  it('uses five observed sessions, next-open entry and round-trip costs for net wins', () => {
    const prices = candles();
    const result = summarizeHistoricalOutcomes('TEST', prices, [buy(prices[0]), buy(prices[5])]);
    expect(result.fixedHold).toMatchObject({ samples: 1, wins: 0, winRatePct: 0 });
    expect(result.fixedHold.averageNetReturnPct).toBeCloseTo(-0.05);
    expect(result.excluded.incomplete).toBe(1);
    expect(result.method.roundTripCostBps).toBe(10);
    expect(result.period).toEqual({ from: '2026-09-29', to: '2026-09-29' });
  });

  it('anchors ATR barriers to the actual next open rather than the signal close', () => {
    const prices = candles();
    for (const bar of prices.slice(1))
      Object.assign(bar, { open: 110, high: 112, low: 108, close: 110 });
    expect(observeAtrBarriers({ atr: 2 }, prices, 0)).toMatchObject({
      stopLoss: 107,
      takeProfit: 116,
      stopTouched: false,
      targetTouched: false,
      firstTouch: 'neither',
    });
  });

  it('leaves a same-session dual first touch ambiguous instead of awarding a win', () => {
    const prices = candles();
    Object.assign(prices[1], { high: 107, low: 96 });
    const observation = observeAtrBarriers({ atr: 2 }, prices, 0);
    expect(observation).toMatchObject({
      firstTouch: 'ambiguous',
      firstTouchFill: null,
      openingGap: false,
    });
    const result = summarizeHistoricalOutcomes('TEST', prices, [buy(prices[0])]);
    expect(result.atrBarriers).toMatchObject({
      samples: 1,
      bothTouched: 1,
      ambiguousFirstTouch: 1,
      stopFirst: 0,
      targetFirst: 0,
      stopTouchRatePct: 100,
      targetTouchRatePct: 100,
    });
    expect(result.fixedHold.wins).toBe(0);
  });

  it.each([
    {
      open: 95,
      high: 107,
      low: 94,
      firstTouch: 'stop',
      fill: 95,
      gapStopFirst: 1,
      gapTargetFirst: 0,
    },
    {
      open: 108,
      high: 109,
      low: 96,
      firstTouch: 'target',
      fill: 108,
      gapStopFirst: 0,
      gapTargetFirst: 1,
    },
  ])('uses the open $open before both intraday barriers and fills at the gap price', (gap) => {
    const prices = candles();
    Object.assign(prices[2], { open: gap.open, high: gap.high, low: gap.low, close: 100 });
    expect(observeAtrBarriers({ atr: 2 }, prices, 0)).toMatchObject({
      firstTouch: gap.firstTouch,
      firstTouchFill: gap.fill,
      openingGap: true,
    });
    const result = summarizeHistoricalOutcomes('TEST', prices, [buy(prices[0])]);
    expect(result.atrBarriers).toMatchObject({
      bothTouched: 1,
      ambiguousFirstTouch: 0,
      gapStopFirst: gap.gapStopFirst,
      gapTargetFirst: gap.gapTargetFirst,
    });
  });

  it('distinguishes later dual touches from unknown ordering on the first touch', () => {
    const prices = candles();
    Object.assign(prices[1], { low: 96, close: 99 });
    Object.assign(prices[2], { high: 107 });
    expect(observeAtrBarriers({ atr: 2 }, prices, 0)).toMatchObject({
      stopTouched: true,
      targetTouched: true,
      firstTouch: 'stop',
      openingGap: false,
    });
  });

  it('keeps unavailable rates null and uses separate denominators for invalid ATR samples', () => {
    const prices = candles();
    const empty = summarizeHistoricalOutcomes('TEST', prices, []);
    expect(empty.fixedHold.winRatePct).toBeNull();
    expect(empty.atrBarriers.stopTouchRatePct).toBeNull();
    const invalidAtr = summarizeHistoricalOutcomes('TEST', prices, [buy(prices[0], 0)]);
    expect(invalidAtr.fixedHold.samples).toBe(1);
    expect(invalidAtr.atrBarriers.samples).toBe(0);
    expect(invalidAtr.excluded.invalidAtrOrCandles).toBe(1);
    expect(invalidAtr.atrBarriers.targetTouchRatePct).toBeNull();
  });

  it('reports only the caller-provided post-warmup evaluation period', () => {
    const prices = candles();
    prices.push({ ...prices[5], date: new Date('2026-10-06') });
    const result = summarizeHistoricalOutcomes('TEST', prices, [buy(prices[0]), buy(prices[1])], {
      start: new Date('2026-09-30'),
    });
    expect(result.fixedHold.samples).toBe(1);
    expect(result.period).toEqual({ from: '2026-09-30', to: '2026-09-30' });
  });
});
