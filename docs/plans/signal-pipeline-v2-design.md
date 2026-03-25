# Signal Pipeline V2 Design

## Overview

A+B 하이브리드 접근법: 다중 필터 게이트 시스템(A) + 그래디언트 스코어링(B)을 결합하여
BUY 시그널 5일 방향 승률을 **75%**로 끌어올리는 것이 목표.

### Current Baseline (2025-08 ~ 2026-03, 195 trading days)

| Metric | Value |
|--------|-------|
| BUY 5-day win rate | 49.8% (113/227) |
| BUY 1-day win rate | 28.2% (66/234) |
| Average return (5d) | +0.89% |
| Reward/Risk ratio | 1.35 |
| ATR TP hit rate | 10.3% |
| ATR SL hit rate | 37.3% |
| Score 200-249 win rate | 78.9% (19 signals) |
| Jan 2026 win rate | 6.9% (downtrend) |

### Target

- BUY 5-day directional win rate: **75%**
- Signal frequency: 2-15 per month (acceptable reduction)
- Approach: unrestricted

---

## Architecture

```
processTicker() [src/commands/predict.ts]
  |
  +-- getHistoricalPrices(ticker, 365)
  +-- calculateAllIndicators()  <-- SMA50, SMA200, volumeRatio added
  +-- detectPatterns()
  |
  +-- evaluateSignal() [src/services/pipeline.ts]  <-- new entry point
        |
        +-- (1) trendGate()        -> FAIL -> return HOLD
        +-- (2) gradientScore()    -> buyScore, sellScore (continuous weights)
        +-- (3) confluenceCheck()  -> < minActive -> return HOLD
        +-- (4) reversalConfirm()  -> analyze last 3 days from historical data
        |
        +-- return PipelineResult

Backtester.generateSignals()
  +-- evaluateSignal() (shared logic, no duplication)
```

---

## New & Modified Files

| File | Action | Description |
|------|--------|-------------|
| `src/services/pipeline.ts` | **NEW** | Pipeline orchestrator, `evaluateSignal()` entry point |
| `src/services/trend-gate.ts` | **NEW** | Trend filter using SMA50/SMA200 |
| `src/services/confluence.ts` | **NEW** | Minimum indicator confluence check |
| `src/services/reversal-confirm.ts` | **NEW** | Stateless reversal confirmation (last 3 days) |
| `src/services/analysis.ts` | **MODIFY** | Replace binary scoring with gradient scoring |
| `src/services/indicators.ts` | **MODIFY** | Add SMA50, SMA200, volumeRatio |
| `src/types/index.ts` | **MODIFY** | Extend IndicatorValues, add pipeline types |
| `src/constants.ts` | **MODIFY** | Add default PipelineConfig values |
| `src/commands/predict.ts` | **MODIFY** | Call `evaluateSignal()` instead of `getOpinion()` |
| `src/optimization/backtester.ts` | **MODIFY** | Use shared `evaluateSignal()` |
| `src/optimization/optimizer.ts` | **MODIFY** | Extend search space for new params |
| `src/commands/learn.ts` | **MODIFY** | Optimize new pipeline params |

---

## Component Details

### 1. Trend Gate (`src/services/trend-gate.ts`)

```typescript
interface TrendGateResult {
  passed: boolean;
  regime: 'uptrend' | 'downtrend' | 'sideways';
  strength: number; // 0-100
  reason: string;
}

interface TrendGateConfig {
  enabled: boolean;
  minConditions: number;      // pass if N of 3 conditions met (default: 2)
  sidewaysThreshold: number;  // SMA50/200 diff % for sideways (default: 2)
}
```

**Conditions (3 total, need `minConditions` to pass):**

| # | Condition | Rationale |
|---|-----------|-----------|
| 1 | close > SMA200 | Price above long-term trend |
| 2 | SMA50 > SMA200 | Golden cross state |
| 3 | close > SMA50 | Price above medium-term trend |

**Sideways detection:**
- `abs(SMA50 - SMA200) / SMA200 < sidewaysThreshold%` AND price between SMA50 and SMA200
- In sideways: relax to `minConditions - 1`

**Edge case:** SMA200 = NaN (insufficient data, < 200 days) -> gate passes with `regime: 'unknown'`, logged as warning.

---

### 2. Gradient Scoring (`src/services/analysis.ts` modified)

Replace binary on/off with continuous gradient functions.

```typescript
// Generic linear gradient: returns 0.0 ~ 1.0
function linearGradient(value: number, max: number, mid: number, zero: number): number {
  if (value <= max) return 1.0;
  if (value >= zero) return 0.0;
  if (value <= mid) return 1.0 - ((value - max) / (mid - max)) * 0.5;
  return 0.5 * ((zero - value) / (zero - mid));
}
```

**Per-indicator gradient ranges (defaults, optimizable):**

| Indicator | max (100%) | mid (50%) | zero (0%) | Direction |
|-----------|:---:|:---:|:---:|-----------|
| RSI | 15 | 30 | 40 | Lower = more oversold |
| Stochastic K | 10 | 20 | 35 | Lower = more oversold |
| Bollinger %B | 0.0 | 0.1 | 0.3 | Lower = below band |
| Williams %R | -90 | -80 | -60 | Lower = more oversold |
| Donchian position | 0.0 | 0.25 | 0.5 | Lower = near channel bottom |
| MACD Histogram | crossover | sustained | negative | Special: decay function |

**Bollinger %B** computed inline: `(close - bbLower) / (bbUpper - bbLower)`

**Donchian position** computed inline: `(close - donchLower) / (donchUpper - donchLower)`

**MACD Histogram gradient:**
- Positive crossover (yesterday <= 0, today > 0): 1.0
- Sustained positive: `1 / (1 + daysSinceCrossover)` decay
- Negative: 0.0
- Requires last N days of MACD histogram (from historical data)

**Fear & Greed**: unchanged (market-wide, not per-stock), but weight reduced in default config.

**SMA20/EMA20 alignment:**
- `close > SMA20 && close > EMA20`: +1.0 * weight
- `close > SMA20 || close > EMA20`: +0.5 * weight
- Neither: 0.0

**Score calculation:**
```typescript
buyScore = sum(gradient_i * weight_i) + patternScore
```

---

### 3. Confluence Check (`src/services/confluence.ts`)

```typescript
interface ConfluenceResult {
  passed: boolean;
  activeIndicators: number;
  totalIndicators: number;
  ratio: number;
}

interface ConfluenceConfig {
  minActive: number;           // minimum active indicators (default: 4)
  activationThreshold: number; // gradient >= this counts as active (default: 0.3)
}
```

An indicator is "active" if its gradient value >= `activationThreshold`.
Total indicators checked: RSI, StochK, Bollinger %B, Donchian position, Williams %R, MACD — **6 indicators**.
Require `minActive` (default 4 of 6) to pass.

---

### 4. Reversal Confirmation (`src/services/reversal-confirm.ts`)

```typescript
interface ReversalConfirmation {
  status: 'confirmed' | 'rejected';
  trigger: 'bullish_candle' | 'volume_spike' | 'both' | null;
}

interface ReversalConfig {
  enabled: boolean;
  volumeMultiplier: number;  // today volume / 20-day avg (default: 1.0)
}
```

**Stateless design** — uses last 3 days from `getHistoricalPrices()`:

```
day[-2]: Check if oversold conditions existed (gradient score above threshold)
day[-1]: Confirmation candle
  - Bullish candle: close > open
  - Volume spike: volume > 20-day average * volumeMultiplier
  - Need at least bullish candle to confirm
day[0]:  Today — final BUY issued if confirmed
```

**If reversalConfirm.enabled = false**: skip this gate entirely (for backtesting flexibility).

---

### 5. Pipeline Orchestrator (`src/services/pipeline.ts`)

```typescript
interface PipelineConfig {
  // Existing (from optimized_weights.json)
  indicatorWeights: IndicatorWeights;
  patternWeights: PatternWeights;
  thresholds: { buy: number; sell: number };
  calibration: { slope: number; intercept: number };

  // New — trend gate
  trendGate: TrendGateConfig;

  // New — gradient ranges
  gradientRanges: {
    rsi: { max: number; mid: number; zero: number };
    stochK: { max: number; mid: number; zero: number };
    williamsR: { max: number; mid: number; zero: number };
    bollingerPctB: { max: number; mid: number; zero: number };
  };

  // New — confluence
  confluence: ConfluenceConfig;

  // New — reversal confirm
  reversalConfirm: ReversalConfig;
}

interface PipelineResult {
  ticker: string;
  finalDecision: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  buyScore: number;
  sellScore: number;
  gateResults: {
    trend: TrendGateResult;
    confluence: ConfluenceResult;
    reversal: ReversalConfirmation;
  };
  confidence: number;
}

// Pure function — no API calls, no side effects
export function evaluateSignal(params: {
  indicators: IndicatorValues;
  close: number;
  open: number;
  fearGreed: number | null;
  patternScore: number;
  recentCandles: { open: number; close: number; high: number; low: number; volume: number }[];
  recentMacdHistogram: number[];
  config: PipelineConfig;
}): PipelineResult
```

**Pipeline flow:**
1. `trendGate()` — if failed and enabled, return HOLD
2. `gradientScore()` — compute continuous buy/sell scores
3. Check if `buyScore >= threshold` and `buyScore >= sellScore` — if not, return HOLD
4. `confluenceCheck()` — if failed, return HOLD
5. `reversalConfirm()` — if rejected and enabled, return HOLD
6. Return BUY with gate results

SELL logic: mirror of BUY (overbought gradient + downtrend or no trend filter for sells).

---

### 6. Indicator Extension (`src/services/indicators.ts`)

Add to `calculateAllIndicators()`:

```typescript
// SMA50
const sma50 = closes.length >= 50
  ? closes.slice(-50).reduce((s, p) => s + p, 0) / 50
  : NaN;

// SMA200
const sma200 = closes.length >= 200
  ? closes.slice(-200).reduce((s, p) => s + p, 0) / 200
  : NaN;

// Volume ratio (requires volumes parameter)
const volumeRatio = volumes.length >= 20
  ? volumes[volumes.length - 1] / (volumes.slice(-20).reduce((s, v) => s + v, 0) / 20)
  : 1.0;
```

`IndicatorValues` interface additions:
```typescript
sma50: number;
sma200: number;
volumeRatio: number;
```

`calculateAllIndicators()` signature change:
```typescript
export function calculateAllIndicators(data: {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];  // NEW
}): IndicatorValues
```

---

### 7. Default Configuration (`src/constants.ts`)

```typescript
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  // ... existing weights/thresholds ...

  trendGate: {
    enabled: true,
    minConditions: 2,
    sidewaysThreshold: 2,
  },

  gradientRanges: {
    rsi: { max: 15, mid: 30, zero: 40 },
    stochK: { max: 10, mid: 20, zero: 35 },
    williamsR: { max: -90, mid: -80, zero: -60 },
    bollingerPctB: { max: 0, mid: 0.1, zero: 0.3 },
  },

  confluence: {
    minActive: 4,
    activationThreshold: 0.3,
  },

  reversalConfirm: {
    enabled: true,
    volumeMultiplier: 1.0,
  },
};
```

---

### 8. Backtester Refactor (`src/optimization/backtester.ts`)

Replace `generateSignals()` body:

```typescript
private generateSignals(params: PipelineConfig): ('BUY' | 'SELL' | 'HOLD')[] {
  const signals: ('BUY' | 'SELL' | 'HOLD')[] = new Array(this.data.length).fill('HOLD');

  for (let i = 200; i < this.data.length; i++) {
    const sliceData = this.data.slice(0, i + 1);
    const closes = sliceData.map(d => d.close);
    const highs = sliceData.map(d => d.high);
    const lows = sliceData.map(d => d.low);
    const volumes = sliceData.map(d => d.volume);

    const indicators = calculateAllIndicators({ closes, highs, lows, volumes });
    const { score: patternScore } = detectPatterns(
      { highs, lows, closes },
      params.patternWeights
    );

    const recentCandles = sliceData.slice(-3).map(d => ({
      open: d.open, close: d.close, high: d.high, low: d.low, volume: d.volume
    }));

    // Extract recent MACD histogram values
    const macdValues = MACD.calculate({ values: closes, ... });
    const recentMacdHistogram = macdValues.slice(-5).map(m => m.histogram ?? 0);

    const result = evaluateSignal({
      indicators,
      close: sliceData[i].close,
      open: sliceData[i].open,
      fearGreed: null,  // not available in backtest
      patternScore,
      recentCandles,
      recentMacdHistogram,
      config: params,
    });

    signals[i] = result.finalDecision;
  }

  return signals;
}
```

**Performance note:** Computing full indicators per bar is expensive. Optimization:
- Pre-compute all indicator arrays once (as current code does)
- Pass pre-computed values to `evaluateSignal()` per bar
- Only `recentCandles` and `recentMacdHistogram` need slicing

---

### 9. Optimizer Extension (`src/optimization/optimizer.ts`)

Add to `generateRandomParams()` search space:

```typescript
trendGate: {
  enabled: true,  // always on during optimization
  minConditions: randomInt(1, 3),
  sidewaysThreshold: randomFloat(1, 5),
},
gradientRanges: {
  rsi: { max: randomFloat(10, 20), mid: randomFloat(25, 35), zero: randomFloat(35, 50) },
  stochK: { max: randomFloat(5, 15), mid: randomFloat(15, 25), zero: randomFloat(30, 45) },
  williamsR: { max: randomFloat(-95, -85), mid: randomFloat(-85, -75), zero: randomFloat(-70, -50) },
  bollingerPctB: { max: randomFloat(-0.1, 0.05), mid: randomFloat(0.05, 0.15), zero: randomFloat(0.2, 0.4) },
},
confluence: {
  minActive: randomInt(3, 6),
  activationThreshold: randomFloat(0.2, 0.5),
},
reversalConfirm: {
  enabled: true,
  volumeMultiplier: randomFloat(0.8, 1.5),
},
```

---

## Testing Strategy

### Existing Test Migration

| Test File | Action |
|-----------|--------|
| `analysis.test.ts` (5 tests) | Rewrite for gradient scoring |
| `indicators.test.ts` (1 test) | Add SMA50/SMA200/volumeRatio assertions |

### New Tests

| File | Cases | Priority |
|------|-------|----------|
| `trend-gate.test.ts` | uptrend pass, downtrend fail, sideways relaxed, SMA200 NaN graceful | HIGH |
| `confluence.test.ts` | 4+ active pass, 3 active fail, threshold boundary | HIGH |
| `reversal-confirm.test.ts` | bullish candle confirmed, bearish rejected, volume spike | HIGH |
| `pipeline.test.ts` | full pipeline integration, each gate intermediate result | HIGH |
| `gradient-scoring.test.ts` | linear gradient boundary values, each indicator | MEDIUM |

### Regression Test (Backtest)

Run on existing 195-day CSV dataset:

```
Before: getOpinion() binary scoring
After:  evaluateSignal() pipeline

Compare:
- Overall BUY 5-day win rate (target: 75%)
- Signal count per month (target: 2-15)
- Monthly win rate breakdown (esp. Jan 2026 improvement)
- Score distribution shift
- Per-ticker win rate changes
```

Script: extend `/tmp/analyze_winrate.py` or add `src/commands/backtest.ts` CLI command.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|:---:|:---:|------------|
| Overfitting to 7-month data | HIGH | HIGH | Walk-forward validation, conservative defaults |
| Signal count drops to < 2/month | MEDIUM | MEDIUM | Tune confluence minActive and gradient ranges |
| SMA200 NaN for new tickers | LOW | LOW | Graceful skip in trend gate |
| Backtester performance regression | MEDIUM | LOW | Pre-compute indicator arrays |

---

## Implementation Order

1. `src/types/index.ts` — extend interfaces
2. `src/services/indicators.ts` — add SMA50/SMA200/volumeRatio
3. `src/constants.ts` — add DEFAULT_PIPELINE_CONFIG
4. `src/services/trend-gate.ts` — new file
5. `src/services/analysis.ts` — gradient scoring
6. `src/services/confluence.ts` — new file
7. `src/services/reversal-confirm.ts` — new file
8. `src/services/pipeline.ts` — orchestrator
9. `src/commands/predict.ts` — integrate pipeline
10. `src/optimization/backtester.ts` — use shared evaluateSignal
11. `src/optimization/optimizer.ts` — extend search space
12. Tests — all new + migrated
13. Regression backtest — validate 75% target
