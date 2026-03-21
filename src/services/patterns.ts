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
  const shoulderDiff = Math.abs(leftShoulder - rightShoulder) / ((leftShoulder + rightShoulder) / 2);
  return head > leftShoulder && head > rightShoulder && shoulderDiff < 0.03;
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

  return { score, patterns };
}
