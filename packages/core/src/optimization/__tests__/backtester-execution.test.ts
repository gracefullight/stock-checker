import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PIPELINE_CONFIG, DEFAULT_ROUND_TRIP_COST_PCT } from '@/constants';
import { Backtester } from '@/optimization/backtester';
import { evaluateSignal } from '@/services/pipeline';

vi.mock('@/services/pipeline', () => ({ evaluateSignal: vi.fn() }));

function candles(count = 214) {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2024, 0, i + 1)),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1_000_000,
  }));
}

describe('Backtester execution and account metrics', () => {
  const decisions = new Map<number, 'BUY' | 'SELL'>();
  beforeEach(() => {
    vi.clearAllMocks();
    decisions.clear();
    vi.mocked(evaluateSignal).mockImplementation(({ currentDate, ticker }) => ({
      ticker,
      finalDecision: decisions.get(currentDate!.getTime()) ?? 'HOLD',
      score: 0,
      buyScore: 0,
      sellScore: 0,
      confidence: 0,
      gateResults: {
        trend: { passed: true, regime: 'uptrend', strength: 100, reason: 'fixture' },
        confluence: { passed: true, activeIndicators: 6, totalIndicators: 6, ratio: 1 },
        reversal: { status: 'confirmed', trigger: 'both' },
        institutional: {
          score: 1,
          passed: true,
          components: { rsSpy: 1, rsSector: 1, vwap: 1, breakoutVol: 1, liquidity: 1, earnings: 1 },
        },
      },
    }));
  });

  it('executes BUY and SELL on the next open after each completed-bar signal', () => {
    const data = candles();
    data[206].open = data[206].close = 120;
    data[208].close = 130;
    data[209].open = data[209].close = 110;
    decisions.set(data[205].date.getTime(), 'BUY');
    decisions.set(data[208].date.getTime(), 'SELL');

    const result = new Backtester(data).run(DEFAULT_PIPELINE_CONFIG);

    expect(result.totalTrades).toBe(1);
    expect(result.winRate).toBe(0);
    expect(result.return).toBeCloseTo((110 - 120) / 120 - DEFAULT_ROUND_TRIP_COST_PCT / 100, 10);
  });

  it('includes the round-trip cost when liquidation happens on the last bar', () => {
    const data = candles();
    decisions.set(data[212].date.getTime(), 'BUY');

    const result = new Backtester(data).run(DEFAULT_PIPELINE_CONFIG);

    expect(result.return).toBeCloseTo(-DEFAULT_ROUND_TRIP_COST_PCT / 100, 10);
    expect(result.maxDrawdown).toBeCloseTo(DEFAULT_ROUND_TRIP_COST_PCT, 10);
  });

  it('does not trade a BUY on the last available bar', () => {
    const data = candles();
    decisions.set(data[213].date.getTime(), 'BUY');

    expect(new Backtester(data).run(DEFAULT_PIPELINE_CONFIG).totalTrades).toBe(0);
  });

  it('never passes future benchmark observations into historic signals', () => {
    const data = candles();
    const benchmark = candles(230);

    new Backtester(data, { spy: benchmark, sector: benchmark }).run(DEFAULT_PIPELINE_CONFIG);

    expect(evaluateSignal).toHaveBeenCalled();
    for (const [input] of vi.mocked(evaluateSignal).mock.calls) {
      expect(input.spyCandles!.every((bar) => bar.date <= input.currentDate!)).toBe(true);
      expect(input.sectorCandles!.every((bar) => bar.date <= input.currentDate!)).toBe(true);
    }
  });

  it('weights profit factor by reinvested account dollars rather than one share', () => {
    const data = candles();
    data[208].open = data[208].close = 110;
    data[210].open = data[210].close = 1_000;
    data[211].close = 1_000;
    data[212].open = data[212].close = 900;
    for (const [idx, decision] of [
      [205, 'BUY'],
      [207, 'SELL'],
      [209, 'BUY'],
      [211, 'SELL'],
    ] as const) {
      decisions.set(data[idx].date.getTime(), decision);
    }

    const result = new Backtester(data).run(DEFAULT_PIPELINE_CONFIG);
    const gain = 10_000 * (0.1 - DEFAULT_ROUND_TRIP_COST_PCT / 100);
    const loss = (10_000 + gain) * (0.1 + DEFAULT_ROUND_TRIP_COST_PCT / 100);

    expect(result.profitFactor).toBeCloseTo(gain / loss, 10);
  });
});
