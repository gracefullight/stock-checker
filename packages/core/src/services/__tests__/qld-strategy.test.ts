import { describe, expect, it } from 'vitest';
import { summarizeQldStrategy } from '@/commands/qld';
import { nextQldWeight, type QldStrategyBar, replayQldStrategy } from '@/services/qld-strategy';

/** A series built from daily returns, starting at 100 on 2020-01-01. */
function series(returns: readonly number[]): QldStrategyBar[] {
  const bars: QldStrategyBar[] = [{ date: '2020-01-01', close: 100 }];
  returns.forEach((change, index) => {
    bars.push({
      date: new Date(Date.UTC(2020, 0, 2 + index)).toISOString().slice(0, 10),
      close: bars[index].close * (1 + change),
    });
  });
  return bars;
}
const repeat = (pattern: readonly number[], sessions: number) =>
  Array.from({ length: sessions }, (_, index) => pattern[index % pattern.length]);

describe('QLD volatility weight', () => {
  it('holds cash for the first 200 sessions, then decides once per close', () => {
    expect(replayQldStrategy(series(repeat([0.001], 199)))).toHaveLength(0);
    const points = replayQldStrategy(series(repeat([0.002, 0.001], 200)));
    expect(points).toHaveLength(1);
    expect(points[0].date).toBe('2020-07-19');
  });

  it('is fully invested when QQQ is calm and scales down as volatility rises', () => {
    // +0.2% / +0.1% alternating: about 0.8% annualised volatility, far below the 10% cap.
    const calm = replayQldStrategy(series(repeat([0.002, 0.001], 320))).at(-1);
    expect(calm).toMatchObject({ target: 1, weight: 1 });

    // +3.2% / -2.8% alternating: 3% daily deviation, 47.6% annualised.
    const wild = replayQldStrategy(series(repeat([0.032, -0.028], 320))).at(-1);
    expect(wild?.volatility20).toBeCloseTo(0.03 * Math.sqrt(252), 10);
    expect(wild?.target).toBeCloseTo(0.2 / (2 * 0.03 * Math.sqrt(252)), 10);
    expect(wild?.weight).toBeCloseTo(0.21, 2);
  });

  it('has no trend filter: a calm decline stays invested', () => {
    const falling = replayQldStrategy(series(repeat([-0.002, 0.001], 300))).at(-1);
    expect(falling?.close).toBeLessThan(100);
    expect(falling?.weight).toBe(1);
  });

  it('moves the weight only when the target is ten points away', () => {
    expect(nextQldWeight({ target: 0.55, held: 0.5 })).toBe(0.5);
    expect(nextQldWeight({ target: 0.62, held: 0.5 })).toBe(0.62);
    expect(nextQldWeight({ target: 0.38, held: 0.5 })).toBe(0.38);
    // From cash a target under ten points is still ignored.
    expect(nextQldWeight({ target: 0.05, held: 0 })).toBe(0);
    expect(nextQldWeight({ target: 0.15, held: 0 })).toBe(0.15);
    // A degenerate series with no volatility reading holds nothing.
    expect(nextQldWeight({ target: 0, held: 0.95 })).toBe(0);
  });

  it('cuts the weight when a calm advance turns violent and restores it afterwards', () => {
    const points = replayQldStrategy(
      series([
        ...repeat([0.002, 0.001], 260),
        ...repeat([-0.04, 0.035], 30),
        ...repeat([0.002, 0.001], 60),
      ])
    );
    const weights = points.map((point) => point.weight);
    expect(weights[0]).toBe(1);
    expect(Math.min(...weights)).toBeLessThan(0.25);
    expect(weights.at(-1)).toBe(1);
    // Every change is at least the ten-point band.
    for (let i = 1; i < weights.length; i++) {
      const move = Math.abs(weights[i] - weights[i - 1]);
      expect(move === 0 || move >= 0.1 - 1e-12).toBe(true);
    }
  });

  it('summarises the latest decision without implying an order', () => {
    const calm = summarizeQldStrategy(replayQldStrategy(series(repeat([0.002, 0.001], 320))));
    expect(calm).toMatchObject({
      strategyId: 'qld-vol-target-v1',
      weightPct: 100,
      previousWeightPct: 100,
      targetWeightPct: 100,
      action: 'hold',
      lastChange: null,
    });

    const points = replayQldStrategy(
      series([...repeat([0.002, 0.001], 260), ...repeat([-0.04, 0.035], 30)])
    );
    const firstCut = points.findIndex((point) => point.weight < 1);
    const cut = summarizeQldStrategy(points.slice(0, firstCut + 1));
    expect(cut).toMatchObject({ previousWeightPct: 100, action: 'sell' });
    expect(cut.weightPct).toBeLessThan(100);
    expect(cut.lastChange).toBe(cut.asOf);
    expect(() => summarizeQldStrategy([])).toThrow(RangeError);
  });
});
