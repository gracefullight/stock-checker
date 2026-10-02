import { describe, expect, it } from 'vitest';
import { DEFAULT_PIPELINE_CONFIG, DEFAULT_ROUND_TRIP_COST_PCT } from '@/constants';
import {
  type BacktestSignal,
  buildEquityCurve,
  buildIndicatorsAtBar,
  buildTickerContext,
  measure5DayWinRate,
  rankTrainingCandidates,
  runSignalsWithContext,
  splitSignalsByExecutionDate,
} from '@/optimization/engine';
import { calculateAllIndicators } from '@/services/indicators';

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
function makePrices(closes: number[]): { date: Date; open: number; close: number }[] {
  return closes.map((close, i) => {
    const date = new Date('2024-01-02');
    date.setDate(date.getDate() + i);
    return { date, open: 100, close };
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

  it('includes observed months with no BUY signals in the monthly rate', () => {
    const prices = Array.from({ length: 100 }, (_, i) => ({
      date: new Date(Date.UTC(2024, 0, 2 + i)),
      open: 100,
      close: 100,
    }));
    const result = measure5DayWinRate([makeSignal()], new Map([['TEST', prices]]), 0);

    expect(result.monthlyBreakdown['2024-02']).toEqual({ wins: 0, total: 0 });
    expect(result.signalsPerMonth).toBe(0.25);
  });

  it('restricts the monthly denominator and observations to the requested evaluation period', () => {
    const prices = Array.from({ length: 100 }, (_, i) => ({
      date: new Date(Date.UTC(2024, 0, 2 + i)),
      open: 100,
      close: 100,
    }));
    const signals = [makeSignal(), makeSignal({ date: prices[30].date })];
    const result = measure5DayWinRate(signals, new Map([['TEST', prices]]), 0, {
      start: new Date('2024-02-01'),
      end: new Date('2024-03-31'),
    });

    expect(Object.keys(result.monthlyBreakdown)).toEqual(['2024-02', '2024-03']);
    expect(result.totalSignals).toBe(1);
    expect(result.signalsPerMonth).toBe(0.5);
  });
});

describe('closed-bar execution', () => {
  it('enters at the next open and excludes the overnight move after the signal', () => {
    const prices = makePrices([100, 120, 120, 120, 120, 110]);
    prices[1].open = 120;

    const result = measure5DayWinRate([makeSignal()], new Map([['TEST', prices]]), 0);
    const curve = buildEquityCurve([makeSignal()], prices, 5, 10_000, 0);

    expect(result.wins).toBe(0);
    expect(result.avgReturn).toBeCloseTo(((110 - 120) / 120) * 100);
    expect(curve.trades[0]).toMatchObject({
      entryDate: '2024-01-03',
      entryPrice: 120,
      exitPrice: 110,
    });
    expect(curve.trades[0].returnPct).toBeCloseTo(result.avgReturn);
  });

  it('includes the drawdown while a losing position recovers before exit', () => {
    const prices = makePrices([100, 100, 50, 100, 100, 100]);
    const result = buildEquityCurve([makeSignal()], prices, 5, 10_000, 0);

    expect(result.totalReturn).toBe(0);
    expect(result.maxDrawdown).toBe(50);
    expect(result.points).toContainEqual({ date: '2024-01-04', equity: 5_000 });
  });

  it('can enter the next session after a prior trade exits', () => {
    const prices = makePrices(Array.from({ length: 11 }, () => 100));
    const second = makeSignal({ date: prices[5].date });

    const result = buildEquityCurve([makeSignal(), second], prices, 5, 10_000, 0);

    expect(result.trades).toHaveLength(2);
    expect(result.trades[1].entryDate).toBe('2024-01-08');
  });

  it('ignores a signal without a complete future holding window', () => {
    const prices = makePrices([100, 100, 100, 100, 100]);
    expect(buildEquityCurve([makeSignal()], prices).trades).toEqual([]);
    expect(measure5DayWinRate([makeSignal()], new Map([['TEST', prices]])).totalSignals).toBe(0);
  });

  it('purges training trades whose outcomes cross into the validation period', () => {
    const prices = Array.from({ length: 16 }, (_, i) => ({
      date: new Date(Date.UTC(2024, 11, 23 + i)),
      open: 100,
      close: 100,
    }));
    const signals = [0, 5, 9].map((i) => makeSignal({ date: prices[i].date }));

    const split = splitSignalsByExecutionDate(
      signals,
      new Map([['TEST', prices]]),
      new Date('2025-01-01')
    );

    expect(split.train).toEqual([signals[0]]);
    expect(split.purged).toEqual([signals[1]]);
    expect(split.holdout).toEqual([signals[2]]);
  });
});

describe('live and historical indicator parity', () => {
  it('keeps real pipeline signals unchanged when extreme future bars are appended', () => {
    const prices = Array.from({ length: 260 }, (_, i) => {
      const close = i < 220 ? 100 + i / 10 + Math.sin(i / 3) * 5 : 1_000_000;
      return {
        date: new Date(Date.UTC(2024, 0, i + 1)),
        open: close,
        high: close + 2,
        low: close - 2,
        close,
        volume: 1_000_000,
      };
    });
    const config = {
      ...DEFAULT_PIPELINE_CONFIG,
      strategy: 'mean-reversion' as const,
      thresholds: { buy: 0, sell: 99_999 },
      trendGate: { ...DEFAULT_PIPELINE_CONFIG.trendGate, enabled: false, source: undefined },
      institutional: { ...DEFAULT_PIPELINE_CONFIG.institutional, enabled: false },
      regimeFilter: { ...DEFAULT_PIPELINE_CONFIG.regimeFilter, enabled: false },
      clusterFilter: { ...DEFAULT_PIPELINE_CONFIG.clusterFilter, enabled: false },
      qualityGate: undefined,
      reversalConfirm: { ...DEFAULT_PIPELINE_CONFIG.reversalConfirm, enabled: false },
      confidenceGate: { ...DEFAULT_PIPELINE_CONFIG.confidenceGate, enabled: false },
      confluence: { minActive: 0, activationThreshold: 0 },
    };
    const prefix = runSignalsWithContext(buildTickerContext(prices.slice(0, 220))!, 'TEST', config);
    const full = runSignalsWithContext(buildTickerContext(prices)!, 'TEST', config);

    expect(prefix.length).toBeGreaterThan(0);
    expect(full.filter((signal) => signal.date <= prices[219].date)).toEqual(prefix);
  });

  it('uses nominal source dollar turnover for the liquidity gate', () => {
    const prices = Array.from({ length: 240 }, (_, i) => ({
      date: new Date(Date.UTC(2024, 0, i + 1)),
      open: 50,
      high: 51,
      low: 49,
      close: 50,
      volume: 1_000_000,
      dollarVolume: 100_000_000,
    }));

    expect(buildTickerContext(prices)!.avgDollarVolArr[215]).toBe(100_000_000);
  });

  it('uses the same current-bar indicators as the live pipeline without future bars', () => {
    const prices = Array.from({ length: 240 }, (_, i) => {
      const close = 100 + i / 10 + Math.sin(i / 3) * 5;
      return {
        date: new Date(Date.UTC(2024, 0, i + 1)),
        open: close - 0.5,
        high: close + 1 + (i % 3),
        low: close - 1 - (i % 2),
        close,
        volume: 1_000_000 + (i % 7) * 100_000,
      };
    });
    const ctx = buildTickerContext(prices)!;
    const i = 215;
    const actual = buildIndicatorsAtBar(
      ctx.closes,
      ctx.highs,
      ctx.lows,
      ctx.volumes,
      ctx.rsiArr,
      ctx.stochArr,
      ctx.bbArr,
      ctx.sma20Arr,
      ctx.ema20Arr,
      ctx.sma50Arr,
      ctx.sma200Arr,
      ctx.williamsArr,
      ctx.atrArr,
      ctx.donchLowerArr,
      ctx.donchUpperArr,
      ctx.volMaArr,
      i,
      ctx.macdArr
    )!;
    const expected = calculateAllIndicators({
      closes: ctx.closes.slice(0, i + 1),
      highs: ctx.highs.slice(0, i + 1),
      lows: ctx.lows.slice(0, i + 1),
      volumes: ctx.volumes.slice(0, i + 1),
    });

    for (const field of [
      'rsi',
      'stochasticK',
      'bbLower',
      'bbUpper',
      'sma20',
      'ema20',
      'sma50',
      'sma200',
      'williamsR',
      'atr',
      'donchLower',
      'donchUpper',
      'volumeRatio',
      'macd',
      'macdSignal',
      'macdHistogram',
    ] as const) {
      expect(actual[field], field).toBeCloseTo(expected[field], 10);
    }
  });
});

describe('candidate selection', () => {
  it('cannot change its training winner when later-period outcomes change', () => {
    const first = { name: 'first', train: { wr: 65, rr: 1.5, n: 50 }, test: { wr: 0 } };
    const second = { name: 'second', train: { wr: 60, rr: 1.5, n: 50 }, test: { wr: 100 } };
    expect(rankTrainingCandidates([first, second])[0].name).toBe('first');
    first.test.wr = 100;
    second.test.wr = 0;
    expect(rankTrainingCandidates([first, second])[0].name).toBe('first');
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
