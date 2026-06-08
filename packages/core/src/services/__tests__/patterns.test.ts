import { describe, expect, it } from 'vitest';
import { detectPatterns } from '@/services/patterns';

describe('patterns', () => {
  it('should detect ascending triangle pattern', () => {
    const highs = [100, 100.5, 100.2, 100.8, 100.3];
    const lows = [95, 96, 97, 98, 99];

    const result = detectPatterns({ highs, lows, closes: [] });

    expect(result.score).toBeGreaterThan(0);
    expect(result.patterns).toContain('AscendingTriangle');
  });

  it('should detect descending triangle pattern', () => {
    const highs = [105, 104, 103, 102, 101];
    const lows = [95, 95.2, 95.1, 95.3, 95.0];

    const result = detectPatterns({ highs, lows, closes: [] });

    expect(result.score).toBeLessThan(0);
    expect(result.patterns).toContain('DescendingTriangle');
  });

  it('should detect bearish flag pattern', () => {
    const closes = [100, 93, 93.5, 93.2, 93.8, 93.4, 93.6, 93.3, 93.7, 93.5];

    const result = detectPatterns({ highs: [], lows: [], closes });

    expect(result.score).toBeLessThan(0);
    expect(result.patterns).toContain('BearishFlag');
  });

  it('should detect double top pattern', () => {
    const highs = [
      95, 96, 100, 98, 97, 96, 95, 94, 93, 92, 91, 93, 100, 98, 97, 96, 95, 94, 93, 92,
    ];

    const result = detectPatterns({ highs, lows: [], closes: [] });

    expect(result.score).toBeLessThan(0);
    expect(result.patterns).toContain('DoubleTop');
  });

  it('should detect rising wedge pattern', () => {
    const highs = [100, 101, 102, 103, 104, 105];
    const lows = [90, 92, 94, 96, 98, 100];

    const result = detectPatterns({ highs, lows, closes: [] });

    expect(result.score).toBeLessThan(0);
    expect(result.patterns).toContain('RisingWedge');
  });

  it('should detect head and shoulders pattern', () => {
    const highs = [95, 96, 98, 97, 96, 95, 97, 100, 99, 96, 95, 96, 98, 97, 96];

    const result = detectPatterns({ highs, lows: [], closes: [] });

    expect(result.score).toBeLessThan(0);
    expect(result.patterns).toContain('HeadAndShoulders');
  });

  it('should return no patterns when none detected', () => {
    const result = detectPatterns({ highs: [], lows: [], closes: [] });

    expect(result.score).toBe(0);
    expect(result.patterns).toHaveLength(0);
  });

  it('should detect bullish pennant pattern', () => {
    // Strong up move in first 3 bars (h[2] > h[0]*1.03), then converging flag
    // Last 5 lows vary > 1% to avoid DescendingTriangle false positive
    const highs = [100, 103, 106, 105, 104, 103, 102, 101, 100, 99];
    const lows = [90, 93, 96, 92, 94, 95, 96, 97, 98, 99];
    const result = detectPatterns({ highs, lows, closes: [] });
    expect(result.patterns).toContain('BullishPennant');
    expect(result.score).toBeGreaterThan(0);
  });

  it('should detect bearish pennant pattern', () => {
    // Strong down in l[2] < l[0]*0.97, then converging flag (highs ↓, lows ↑)
    const lows = [100, 97, 94, 95, 96, 97, 97.5, 98, 98.3, 98.5];
    const highs = [102, 100, 98, 100, 99.5, 99, 98.5, 98, 97.5, 97];
    const result = detectPatterns({ highs, lows, closes: [] });
    expect(result.patterns).toContain('BearishPennant');
    expect(result.score).toBeLessThan(0);
  });

  it('should detect cup with handle pattern', () => {
    const closes = [
      100, 99, 98, 97, 96, 92, 90, 88, 87, 88, 90, 92, 94, 96, 97, 98, 99, 100, 100, 99, 100, 100,
      100, 100, 100, 99.5, 99, 99.5, 99.8, 100,
    ];
    const result = detectPatterns({ highs: [], lows: [], closes });
    expect(result.patterns).toContain('CupWithHandle');
    expect(result.score).toBeGreaterThan(0);
  });

  it('should detect three rising valleys', () => {
    const lows = [
      80,
      82,
      81,
      80,
      79, // valley 1 min = 79
      83,
      85,
      84,
      83,
      82, // valley 2 min = 82 > 79
      86,
      88,
      87,
      86,
      85, // valley 3 min = 85 > 82
    ];
    const result = detectPatterns({ highs: [], lows, closes: [] });
    expect(result.patterns).toContain('ThreeRisingValleys');
    expect(result.score).toBeGreaterThan(0);
  });

  it('should detect three descending peaks', () => {
    const highs = [
      120,
      118,
      117,
      116,
      115, // peak 1 max = 120
      114,
      112,
      111,
      110,
      109, // peak 2 max = 114 < 120
      108,
      106,
      105,
      104,
      103, // peak 3 max = 108 < 114
    ];
    const result = detectPatterns({ highs, lows: [], closes: [] });
    expect(result.patterns).toContain('ThreeDescendingPeaks');
    expect(result.score).toBeLessThan(0);
  });

  it('should detect ascending scallop', () => {
    const lows = [
      100,
      99,
      97,
      96,
      95,
      96,
      97,
      98,
      99,
      100, // valley1 min=95
      102,
      101,
      100,
      99,
      98,
      99,
      100,
      101,
      102,
      103, // valley2 min=98 > 95
    ];
    const closes = [
      100,
      99,
      98,
      97,
      96,
      98,
      100,
      101,
      102,
      103,
      104,
      103,
      102,
      101,
      100,
      102,
      103,
      104,
      105,
      106, // end > start * 1.02
    ];
    const result = detectPatterns({ highs: [], lows, closes });
    expect(result.patterns).toContain('AscendingScallop');
    expect(result.score).toBeGreaterThan(0);
  });

  it('should detect descending scallop', () => {
    const highs = [
      100,
      101,
      102,
      101,
      100,
      99,
      98,
      97,
      96,
      95, // peak1 max=102
      94,
      95,
      96,
      95,
      94,
      93,
      92,
      91,
      90,
      89, // peak2 max=96 < 102
    ];
    const closes = [
      100,
      100,
      99,
      98,
      97,
      96,
      95,
      94,
      93,
      92,
      91,
      91,
      90,
      89,
      88,
      87,
      86,
      85,
      84,
      83, // end < start*0.98
    ];
    const result = detectPatterns({ highs, lows: [], closes });
    expect(result.patterns).toContain('DescendingScallop');
    expect(result.score).toBeLessThan(0);
  });

  it('should detect measured move up', () => {
    const closes = [
      100,
      101,
      102,
      103,
      104,
      105,
      106,
      107,
      108,
      109, // leg1: +9
      109,
      110,
      110,
      109,
      110,
      110,
      109,
      110,
      110,
      109, // consolidation
      109,
      110,
      111,
      112,
      113,
      114,
      115,
      116,
      117,
      118, // leg2: +9
    ];
    const result = detectPatterns({ highs: [], lows: [], closes });
    expect(result.patterns).toContain('MeasuredMoveUp');
    expect(result.score).toBeGreaterThan(0);
  });

  it('should detect measured move down', () => {
    const closes = [
      118,
      117,
      116,
      115,
      114,
      113,
      112,
      111,
      110,
      109, // leg1: -9
      109,
      110,
      110,
      109,
      109,
      110,
      110,
      109,
      109,
      110, // consolidation
      110,
      109,
      108,
      107,
      106,
      105,
      104,
      103,
      102,
      101, // leg2: -9
    ];
    const result = detectPatterns({ highs: [], lows: [], closes });
    expect(result.patterns).toContain('MeasuredMoveDown');
    expect(result.score).toBeLessThan(0);
  });

  it('should detect diamond bottom', () => {
    // Widening then narrowing diamond shape at bottom
    // Last segment highs vary (one uptick) to avoid DescendingTriangle false positive
    const highs = [
      100,
      100,
      100,
      100,
      100, // h1 max=100
      105,
      105,
      105,
      105,
      105, // h2 max=105 > 100
      103,
      103,
      103,
      103,
      103, // h3 max=103 < 105
      100,
      102,
      101,
      100,
      101, // h4 max=102 < 103; uptick at [1] breaks DescendingTriangle
    ];
    const lows = [
      95,
      95,
      95,
      95,
      95, // l1 min=95
      90,
      90,
      90,
      90,
      90, // l2 min=90 < 95
      92,
      92,
      92,
      92,
      92, // l3 min=92 > 90
      94,
      94,
      94,
      94,
      94, // l4 min=94 > 92
    ];
    const result = detectPatterns({ highs, lows, closes: [] });
    expect(result.patterns).toContain('DiamondBottom');
    expect(result.score).toBeGreaterThan(0);
  });

  it('should detect tops rectangle', () => {
    // Flat highs and flat lows over 20 bars with small zone
    const highs = new Array(20).fill(102);
    const lows = new Array(20).fill(99);
    const result = detectPatterns({ highs, lows, closes: [] });
    expect(result.patterns).toContain('TopsRectangle');
    expect(result.score).toBeLessThan(0);
  });
});
