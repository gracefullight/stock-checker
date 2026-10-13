import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TickerResult } from '@/types';
import {
  formatBaseRateLines,
  formatScoreMix,
  printSummaryTable,
  VALIDATED_BASE_RATE,
} from '@/ui/summary';

const row = (overrides: Partial<TickerResult>): TickerResult => ({
  ticker: 'TSLA',
  date: '2026-10-02',
  close: 100,
  volume: 1,
  rsi: 50,
  stochasticK: 50,
  bbLower: 90,
  bbUpper: 110,
  donchLower: 90,
  donchUpper: 110,
  williamsR: -50,
  fearGreed: 50,
  patterns: [],
  score: 100,
  opinion: 'HOLD',
  atr: 1,
  stopLoss: 98,
  takeProfit: 104,
  trailingStop: 98,
  trailingStart: 102,
  macd: 0,
  macdSignal: 0,
  macdHistogram: 0,
  sma20: 100,
  ema20: 100,
  buyProbability: 79,
  sellProbability: 10,
  confidence: 'very-high',
  ...overrides,
});

// biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI colors for assertions
const plain = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '');

describe('CLI summary table', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides the legacy score mix for blocked HOLD rows and never prints confidence', () => {
    expect(formatScoreMix(row({ opinion: 'HOLD' }))).toBe('—');
    expect(formatScoreMix(row({ opinion: 'BUY' }))).toBe('B79/S10');
    expect(formatScoreMix(row({ opinion: 'SELL', buyProbability: 5, sellProbability: 60 }))).toBe(
      'B5/S60'
    );
    expect(
      formatScoreMix(row({ opinion: 'BUY', buyProbability: undefined, sellProbability: undefined }))
    ).toBe('—');
  });

  it('prints score mix instead of Buy%/Confidence and the measured base rate with the SPY note', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(plain(args.map(String).join(' ')));
    });

    printSummaryTable([row({ opinion: 'HOLD' }), row({ ticker: 'OII', opinion: 'BUY' })]);

    const output = lines.join('\n');
    expect(output).toContain('Score mix');
    expect(output).not.toContain('Buy%');
    expect(output).not.toContain('Confidence');
    expect(output).not.toContain('very-high');
    expect(output).toMatch(/TSLA.*HOLD\s+—/);
    expect(output).toMatch(/OII.*BUY\s+B79\/S10/);
    expect(output).toContain('n=155 trades, 57.4% positive, +0.63% mean net per trade');
    expect(output).toContain('SPY over the same windows +0.48% mean, 63.2% positive');
    expect(output).toContain('Scores are not win probabilities');
  });

  it('keeps the published base-rate constants in sync with the validation report', () => {
    expect(VALIDATED_BASE_RATE).toMatchObject({
      trades: 155,
      winRatePct: 57.4,
      meanNetReturnPct: 0.63,
      benchmark: { symbol: 'SPY', meanNetReturnPct: 0.48, winRatePct: 63.2 },
    });
    expect(formatBaseRateLines()).toHaveLength(2);
    expect(formatBaseRateLines()[0]).toContain('in-sample');
  });
});
