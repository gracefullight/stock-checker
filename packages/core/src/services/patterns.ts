import { PATTERN_WEIGHTS } from '@/constants';
import type { PatternResult } from '@/types';

function isAscendingTriangle(highs: number[], lows: number[]): boolean {
  const recentHighs = highs.slice(-5);
  const recentLows = lows.slice(-5);
  if (recentHighs.length < 5) return false;
  const maxHigh = Math.max(...recentHighs);
  const minHigh = Math.min(...recentHighs);
  const flatTop = (maxHigh - minHigh) / maxHigh < 0.01;
  const risingLows = recentLows.every((v, i, arr) => i === 0 || v >= arr[i - 1]);
  return flatTop && risingLows;
}

function isBullishFlag(closes: number[]): boolean {
  const recent = closes.slice(-10);
  if (recent.length < 10) return false;
  const first = recent[0];
  const max = Math.max(...recent);
  const min = Math.min(...recent);
  const strongUp = (max - first) / first > 0.05;
  const tightRange = (max - min) / max < 0.05;
  return strongUp && tightRange;
}

function isDoubleBottom(lows: number[]): boolean {
  const recent = lows.slice(-20);
  if (recent.length < 20) return false;
  const firstMin = Math.min(...recent.slice(0, 10));
  const secondMin = Math.min(...recent.slice(10));
  const diff = Math.abs(firstMin - secondMin) / ((firstMin + secondMin) / 2);
  return diff < 0.02;
}

function isFallingWedge(highs: number[], lows: number[]): boolean {
  const recentHighs = highs.slice(-6);
  const recentLows = lows.slice(-6);
  if (recentHighs.length < 6) return false;
  const lowerHighs = recentHighs.every((v, i, arr) => i === 0 || v < arr[i - 1]);
  const lowerLows = recentLows.every((v, i, arr) => i === 0 || v < arr[i - 1]);
  const highSlope = recentHighs[0] - recentHighs[recentHighs.length - 1];
  const lowSlope = recentLows[0] - recentLows[recentLows.length - 1];
  return lowerHighs && lowerLows && highSlope > lowSlope;
}

function isIslandReversal(closes: number[]): boolean {
  const recent = closes.slice(-5);
  if (recent.length < 5) return false;
  const gapDown = recent[1] < recent[0] * 0.95;
  const gapUp = recent[3] > recent[2] * 1.05;
  return gapDown && gapUp;
}

function isDescendingTriangle(highs: number[], lows: number[]): boolean {
  const recentHighs = highs.slice(-5);
  const recentLows = lows.slice(-5);
  if (recentLows.length < 5) return false;
  const maxLow = Math.max(...recentLows);
  const minLow = Math.min(...recentLows);
  const flatBottom = (maxLow - minLow) / maxLow < 0.01;
  const fallingHighs = recentHighs.every((v, i, arr) => i === 0 || v <= arr[i - 1]);
  return flatBottom && fallingHighs;
}

function isBearishFlag(closes: number[]): boolean {
  const recent = closes.slice(-10);
  if (recent.length < 10) return false;
  const first = recent[0];
  const min = Math.min(...recent);
  const strongDown = (first - min) / first > 0.05;
  const consolidation = recent.slice(1);
  const conMax = Math.max(...consolidation);
  const conMin = Math.min(...consolidation);
  const tightRange = (conMax - conMin) / conMax < 0.05;
  return strongDown && tightRange;
}

function isDoubleTop(highs: number[]): boolean {
  const recent = highs.slice(-20);
  if (recent.length < 20) return false;
  const firstMax = Math.max(...recent.slice(0, 10));
  const secondMax = Math.max(...recent.slice(10));
  const diff = Math.abs(firstMax - secondMax) / ((firstMax + secondMax) / 2);
  return diff < 0.02;
}

function isRisingWedge(highs: number[], lows: number[]): boolean {
  const recentHighs = highs.slice(-6);
  const recentLows = lows.slice(-6);
  if (recentHighs.length < 6) return false;
  const higherHighs = recentHighs.every((v, i, arr) => i === 0 || v > arr[i - 1]);
  const higherLows = recentLows.every((v, i, arr) => i === 0 || v > arr[i - 1]);
  const highSlope = recentHighs[recentHighs.length - 1] - recentHighs[0];
  const lowSlope = recentLows[recentLows.length - 1] - recentLows[0];
  return higherHighs && higherLows && lowSlope > highSlope;
}

function isHeadAndShoulders(highs: number[]): boolean {
  const recent = highs.slice(-15);
  if (recent.length < 15) return false;
  const leftShoulder = Math.max(...recent.slice(0, 5));
  const head = Math.max(...recent.slice(5, 10));
  const rightShoulder = Math.max(...recent.slice(10));
  const shoulderDiff =
    Math.abs(leftShoulder - rightShoulder) / ((leftShoulder + rightShoulder) / 2);
  return head > leftShoulder && head > rightShoulder && shoulderDiff < 0.03;
}

function isBullishPennant(highs: number[], lows: number[]): boolean {
  const h = highs.slice(-10);
  const l = lows.slice(-10);
  if (h.length < 10) return false;
  const poleUp = h[2] > h[0] * 1.03;
  const flagHighs = h.slice(3);
  const flagLows = l.slice(3);
  const converging =
    flagHighs.every((v, i, arr) => i === 0 || v <= arr[i - 1]) &&
    flagLows.every((v, i, arr) => i === 0 || v >= arr[i - 1]);
  return poleUp && converging;
}

function isBearishPennant(highs: number[], lows: number[]): boolean {
  const h = highs.slice(-10);
  const l = lows.slice(-10);
  if (l.length < 10) return false;
  const poleDown = l[2] < l[0] * 0.97;
  const flagHighs = h.slice(3);
  const flagLows = l.slice(3);
  const converging =
    flagHighs.every((v, i, arr) => i === 0 || v <= arr[i - 1]) &&
    flagLows.every((v, i, arr) => i === 0 || v >= arr[i - 1]);
  return poleDown && converging;
}

function isCupWithHandle(closes: number[]): boolean {
  const c = closes.slice(-30);
  if (c.length < 30) return false;
  const rim = Math.max(c[0], c[24]);
  const bottom = Math.min(...c.slice(5, 25));
  const depth = (rim - bottom) / rim;
  const cupShape = depth > 0.08 && depth < 0.35 && Math.abs(c[0] - c[24]) / c[0] < 0.03;
  const handleHigh = Math.max(...c.slice(25));
  const handleLow = Math.min(...c.slice(25));
  const handlePull = (handleHigh - handleLow) / handleHigh < 0.08;
  return cupShape && handlePull && c[c.length - 1] >= handleHigh * 0.97;
}

function isInvertedCupWithHandle(closes: number[]): boolean {
  const c = closes.slice(-30);
  if (c.length < 30) return false;
  const base = Math.min(c[0], c[24]);
  const top = Math.max(...c.slice(5, 25));
  const depth = (top - base) / base;
  const shape = depth > 0.08 && depth < 0.35 && Math.abs(c[0] - c[24]) / c[0] < 0.03;
  const last5 = c.slice(25);
  const last5High = Math.max(...last5);
  const handleBounce = (last5High - Math.min(...last5)) / last5High < 0.05;
  return shape && handleBounce && c[c.length - 1] <= last5High * 1.02;
}

function isThreeRisingValleys(lows: number[]): boolean {
  const l = lows.slice(-15);
  if (l.length < 15) return false;
  const v1 = Math.min(...l.slice(0, 5));
  const v2 = Math.min(...l.slice(5, 10));
  const v3 = Math.min(...l.slice(10));
  return v2 > v1 * 1.01 && v3 > v2 * 1.01;
}

function isThreeDescendingPeaks(highs: number[]): boolean {
  const h = highs.slice(-15);
  if (h.length < 15) return false;
  const p1 = Math.max(...h.slice(0, 5));
  const p2 = Math.max(...h.slice(5, 10));
  const p3 = Math.max(...h.slice(10));
  return p2 < p1 * 0.99 && p3 < p2 * 0.99;
}

function isAscendingScallop(lows: number[], closes: number[]): boolean {
  const l = lows.slice(-20);
  const c = closes.slice(-20);
  if (l.length < 20) return false;
  const v1 = Math.min(...l.slice(0, 10));
  const v2 = Math.min(...l.slice(10));
  return v2 > v1 * 1.01 && c[c.length - 1] > c[0] * 1.02;
}

function isDescendingScallop(highs: number[], closes: number[]): boolean {
  const h = highs.slice(-20);
  const c = closes.slice(-20);
  if (h.length < 20) return false;
  const p1 = Math.max(...h.slice(0, 10));
  const p2 = Math.max(...h.slice(10));
  return p2 < p1 * 0.99 && c[c.length - 1] < c[0] * 0.98;
}

function isMeasuredMoveUp(closes: number[]): boolean {
  const c = closes.slice(-30);
  if (c.length < 30) return false;
  const leg1 = c[9] - c[0];
  const cons = c[19] - c[9];
  const leg2 = c[29] - c[19];
  const similarLegs = Math.abs(leg1 - leg2) / Math.abs(leg1 || 1) < 0.2;
  return leg1 > 0 && leg2 > 0 && cons < leg1 * 0.5 && similarLegs;
}

function isMeasuredMoveDown(closes: number[]): boolean {
  const c = closes.slice(-30);
  if (c.length < 30) return false;
  const leg1 = c[0] - c[9];
  const cons = c[9] - c[19];
  const leg2 = c[19] - c[29];
  const similarLegs = Math.abs(leg1 - leg2) / Math.abs(leg1 || 1) < 0.2;
  return leg1 > 0 && leg2 > 0 && cons < leg1 * 0.5 && similarLegs;
}

function isDiamondBottom(highs: number[], lows: number[]): boolean {
  const h = highs.slice(-20);
  const l = lows.slice(-20);
  if (h.length < 20) return false;
  const h1 = Math.max(...h.slice(0, 5));
  const h2 = Math.max(...h.slice(5, 10));
  const h3 = Math.max(...h.slice(10, 15));
  const h4 = Math.max(...h.slice(15));
  const l1 = Math.min(...l.slice(0, 5));
  const l2 = Math.min(...l.slice(5, 10));
  const l3 = Math.min(...l.slice(10, 15));
  const l4 = Math.min(...l.slice(15));
  const widening = h2 > h1 && l2 < l1;
  const narrowing = h3 < h2 && l3 > l2 && h4 < h3 && l4 > l3;
  return widening && narrowing;
}

function isTopsRectangle(highs: number[], lows: number[]): boolean {
  const h = highs.slice(-20);
  const l = lows.slice(-20);
  if (h.length < 20) return false;
  const maxH = Math.max(...h);
  const minH = Math.min(...h);
  const maxL = Math.max(...l);
  const minL = Math.min(...l);
  const flatTop = (maxH - minH) / maxH < 0.03;
  const flatBottom = (maxL - minL) / maxL < 0.03;
  const zone = (maxH - maxL) / maxH;
  return flatTop && flatBottom && zone > 0.02 && zone < 0.08;
}

export function detectPatterns(
  data: {
    highs: number[];
    lows: number[];
    closes: number[];
  },
  customWeights?: Record<string, number>
): PatternResult {
  const { highs, lows, closes } = data;
  const weights = { ...PATTERN_WEIGHTS, ...customWeights };
  let score = 0;
  const patterns: string[] = [];

  if (isAscendingTriangle(highs, lows)) {
    score += weights.ascendingTriangle;
    patterns.push('AscendingTriangle');
  }
  if (isBullishFlag(closes)) {
    score += weights.bullishFlag;
    patterns.push('BullishFlag');
  }
  if (isDoubleBottom(lows)) {
    score += weights.doubleBottom;
    patterns.push('DoubleBottom');
  }
  if (isFallingWedge(highs, lows)) {
    score += weights.fallingWedge;
    patterns.push('FallingWedge');
  }
  if (isIslandReversal(closes)) {
    score += weights.islandReversal;
    patterns.push('IslandReversal');
  }
  if (isDescendingTriangle(highs, lows)) {
    score += weights.descendingTriangle;
    patterns.push('DescendingTriangle');
  }
  if (isBearishFlag(closes)) {
    score += weights.bearishFlag;
    patterns.push('BearishFlag');
  }
  if (isDoubleTop(highs)) {
    score += weights.doubleTop;
    patterns.push('DoubleTop');
  }
  if (isRisingWedge(highs, lows)) {
    score += weights.risingWedge;
    patterns.push('RisingWedge');
  }
  if (isHeadAndShoulders(highs)) {
    score += weights.headAndShoulders;
    patterns.push('HeadAndShoulders');
  }
  if (isBullishPennant(highs, lows)) {
    score += weights.bullishPennant ?? 70;
    patterns.push('BullishPennant');
  }
  if (isBearishPennant(highs, lows)) {
    score += weights.bearishPennant ?? -70;
    patterns.push('BearishPennant');
  }
  if (isCupWithHandle(closes)) {
    score += weights.cupWithHandle ?? 75;
    patterns.push('CupWithHandle');
  }
  if (isInvertedCupWithHandle(closes)) {
    score += weights.invertedCupWithHandle ?? -68;
    patterns.push('InvertedCupWithHandle');
  }
  if (isThreeRisingValleys(lows)) {
    score += weights.threeRisingValleys ?? 72;
    patterns.push('ThreeRisingValleys');
  }
  if (isThreeDescendingPeaks(highs)) {
    score += weights.threeDescendingPeaks ?? -72;
    patterns.push('ThreeDescendingPeaks');
  }
  if (isAscendingScallop(lows, closes)) {
    score += weights.ascendingScallop ?? 65;
    patterns.push('AscendingScallop');
  }
  if (isDescendingScallop(highs, closes)) {
    score += weights.descendingScallop ?? -65;
    patterns.push('DescendingScallop');
  }
  if (isMeasuredMoveUp(closes)) {
    score += weights.measuredMoveUp ?? 68;
    patterns.push('MeasuredMoveUp');
  }
  if (isMeasuredMoveDown(closes)) {
    score += weights.measuredMoveDown ?? -68;
    patterns.push('MeasuredMoveDown');
  }
  if (isDiamondBottom(highs, lows)) {
    score += weights.diamondBottom ?? 68;
    patterns.push('DiamondBottom');
  }
  if (isTopsRectangle(highs, lows)) {
    score += weights.topsRectangle ?? -65;
    patterns.push('TopsRectangle');
  }

  return { score, patterns };
}
