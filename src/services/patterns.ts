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

  return { score, patterns };
}
