import { describe, expect, it } from 'vitest';
import { measureTrendHoldWinRate } from '@/commands/backtest';
import type { BacktestSignal, Candle } from '@/optimization/engine';

function fixture(bars: Partial<Candle>[]): {
  signals: BacktestSignal[];
  data: Map<string, Candle[]>;
} {
  const data = bars.map((bar, i) => ({
    date: new Date(Date.UTC(2024, 0, i + 1)),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1_000_000,
    ...bar,
  }));
  return {
    signals: [
      {
        date: data[0].date,
        ticker: 'TEST',
        close: data[0].close,
        decision: 'BUY',
      } as BacktestSignal,
    ],
    data: new Map([['TEST', data]]),
  };
}

describe('trend-hold daily-bar execution', () => {
  it('fills a stop gap at the next session open even when the close recovers', () => {
    const { signals, data } = fixture([{}, {}, { open: 80, low: 75, high: 105, close: 100 }, {}]);

    const result = measureTrendHoldWinRate(signals, data, { stopPct: 8, tpPct: 50, costPct: 0 });

    expect(result.avgReturn).toBe(-20);
    expect(result.avgHoldBars).toBe(2);
  });

  it('uses the stop first when a daily bar crosses both bracket exits', () => {
    const { signals, data } = fixture([{}, { high: 110, low: 90, close: 100 }, {}]);

    const result = measureTrendHoldWinRate(signals, data, { stopPct: 8, tpPct: 5, costPct: 0 });

    expect(result.avgReturn).toBeCloseTo(-8, 10);
    expect(result.avgHoldBars).toBe(1);
  });

  it('uses the next open rather than the already known signal close for entry', () => {
    const { signals, data } = fixture([
      {},
      { open: 120, high: 122, low: 115, close: 120 },
      { close: 120, high: 121, low: 119 },
    ]);

    const result = measureTrendHoldWinRate(signals, data, {
      stopPct: 50,
      tpPct: 50,
      maxHold: 2,
      costPct: 0,
    });

    expect(result.avgReturn).toBe(0);
  });
});
