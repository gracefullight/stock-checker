import { describe, expect, it } from 'vitest';
import {
  classifyNearMiss,
  sortByNearMiss,
} from '@/features/market-screen/utils/classify-near-miss';
import { fixtureMarketScreenSnapshot } from '@/features/market-screen/utils/market-screen-test-fixtures';
import type { StockScreenMatch } from '@/lib/api';

function excluded(overrides: Partial<StockScreenMatch> = {}): StockScreenMatch {
  const item = fixtureMarketScreenSnapshot(undefined, 'excluded').page.items[0];
  if (!('decision' in item)) throw new Error('fixture');
  return { ...item, ...overrides };
}

describe('classifyNearMiss', () => {
  it('ranks a quality-gate rejection as the closest miss', () => {
    const info = classifyNearMiss(
      excluded({
        buyScore: 260,
        gateReasons: ['The entry-quality gate rejected this score-qualified BUY setup.'],
      })
    );
    expect(info.tier).toBe('quality-blocked');
    expect(info.rank).toBe(0);
    expect(info.detail).toContain('진입 품질 게이트');
  });

  it('uses structured failed checks for the detail when the API sends them', () => {
    const info = classifyNearMiss(
      excluded({
        buyScore: 260,
        blockedBy: {
          gate: 'quality',
          checks: [
            { id: 'belowSma50', passed: false },
            { id: 'ibs', passed: true },
          ],
        },
      })
    );
    expect(info.tier).toBe('quality-blocked');
    expect(info.detail).toBe('SMA50 아래 풀백: 실패');
  });

  it('separates score-qualified, near-score, RS-ok, trend-only and trend-fail tiers', () => {
    expect(classifyNearMiss(excluded({ buyScore: 250 })).tier).toBe('gated');
    expect(classifyNearMiss(excluded({ buyScore: 170 })).tier).toBe('score-near');
    expect(classifyNearMiss(excluded({ buyScore: 100 })).tier).toBe('trend-rs-ok');
    const weakRs = excluded({ buyScore: 100 });
    weakRs.gates = {
      ...weakRs.gates,
      institutional: {
        ...weakRs.gates.institutional,
        components: { ...weakRs.gates.institutional.components, rsSpy: 0.2 },
      },
    };
    const trendOnly = classifyNearMiss(weakRs);
    expect(trendOnly.tier).toBe('trend-ok');
    expect(trendOnly.detail).toContain('SPY 0.20');
    const downtrend = excluded({ buyScore: 300 });
    downtrend.gates = {
      ...downtrend.gates,
      trend: { passed: false, regime: 'downtrend', strength: 0, reason: 'Downward trend' },
    };
    expect(classifyNearMiss(downtrend).tier).toBe('trend-fail');
  });

  it('respects frozen-config thresholds', () => {
    expect(
      classifyNearMiss(excluded({ buyScore: 120 }), { buyThreshold: 100, rsMin: 0.5 }).tier
    ).toBe('gated');
  });

  it('sorts closest tier first, then by buy score', () => {
    const sorted = sortByNearMiss([
      excluded({ ticker: 'LOW', buyScore: 50 }),
      excluded({ ticker: 'NEAR', buyScore: 180 }),
      excluded({
        ticker: 'QUAL',
        buyScore: 210,
        gateReasons: ['The entry-quality gate rejected this score-qualified BUY setup.'],
      }),
      excluded({ ticker: 'NEAR2', buyScore: 190 }),
    ]);
    expect(sorted.map((entry) => entry.item.ticker)).toEqual(['QUAL', 'NEAR2', 'NEAR', 'LOW']);
  });
});
