# Pipeline V3 — Institutional Score Design

## 목표

기존 파이프라인 v2(기술적 신호)에 **기관 시각의 수급 신호**를 두 번째 축으로 추가.
"차트는 신호, 거래량은 증거, 수급은 확신" 철학을 구조적으로 반영.

---

## 아키텍처

```
evaluateSignal()
  │
  ├── Gate 1: trendGate()              (기존 유지)
  ├── Gate 2: gradientScore()          → technicalScore
  ├── Gate 2.5: institutionalScore()   → institutionalScore  [신규]
  │
  ├── technicalScore >= buy.threshold
  │   AND institutionalScore >= institutional.threshold
  │     NO → HOLD
  │
  ├── Gate 3: confluenceCheck()
  ├── Gate 4: reversalConfirm()
  └── Gate 5: ensembleConfidence()     (institutional 가중치 추가)
```

---

## InstitutionalScore 구성 (6개 신호)

```
institutionalScore =
  rsSpyGrad      * w.rsSpy       // SPY 대비 상대강도
  + rsSectorGrad   * w.rsSector    // 섹터 ETF 대비 상대강도
  + vwapGrad       * w.vwap        // 20일 VWAP 근사 위치
  + breakoutVolGrad* w.breakoutVol // 돌파 + 거래량 확인
  + liquidityGrad  * w.liquidity   // 기관 접근 가능 유동성
  + earningsGrad   * w.earnings    // EPS 추정치 방향
```

### 신호 1 & 2: 상대강도 (RS)

```typescript
// 13주(63일) + 26주(126일) 초과 수익률
const tickerReturn13w  = (close[-1] - close[-63])  / close[-63];
const benchReturn13w   = (bench[-1]  - bench[-63])  / bench[-63];
const rs13w = tickerReturn13w - benchReturn13w;

// gradient: rs > +10% → 1.0, rs > 0% → 0.5, rs < -5% → 0.0
// 최종: rs13w * 0.4 + rs26w * 0.6  (장기 가중)
```

### 신호 3: VWAP 근사 (20일)

```typescript
const vwap20 = sum((H+L+C)/3 * V, 20d) / sum(V, 20d);

// close > vwap20 && volumeRatio > 1.0 → 1.0
// close > vwap20                       → 0.6
// close < vwap20                       → 0.0
```

### 신호 4: 거래량 돌파 확인

기존 `volumeSpike` gate(차단 로직) 제거 후 대체.

```typescript
const nearBreakout    = close >= donchUpper * 0.98;
const volumeConfirmed = volumeRatio >= 1.5;

// nearBreakout + volumeConfirmed → 1.0
// nearBreakout only              → 0.5
// neither                        → 0.0
```

### 신호 5: 유동성

```typescript
const avgDailyDollarVol = avg(close[i] * volume[i], 20d);

// $50M+ → 1.0
// $10M+ → 0.7
// $5M+  → 0.4
// < $5M → 0.0
```

### 신호 6: 실적 추정치 방향

```typescript
// EPS beat + 추정치 상향 → 1.0
// EPS beat only          → 0.6
// EPS miss               → 0.0
// 데이터 없음             → 0.3 (중립)
```

### 기본 가중치

```typescript
export const DEFAULT_INSTITUTIONAL_CONFIG: InstitutionalConfig = {
  enabled: true,
  weights: {
    rsSpy:      0.25,
    rsSector:   0.25,
    vwap:       0.20,
    breakoutVol:0.15,
    liquidity:  0.10,
    earnings:   0.05,
  },
  threshold: 0.45,
  rsLookback: { short: 63, long: 126 },
  minAvgDailyDollarVol: 5_000_000,
};
```

---

## 섹터 ETF 매핑

```typescript
export const SECTOR_ETF_MAP: Record<string, string> = {
  Technology:               'XLK',
  Healthcare:               'XLV',
  Financials:               'XLF',
  'Consumer Discretionary': 'XLY',
  'Consumer Staples':       'XLP',
  Industrials:              'XLI',
  Energy:                   'XLE',
  Materials:                'XLB',
  Utilities:                'XLU',
  'Real Estate':            'XLRE',
  'Communication Services': 'XLC',
};
export const MARKET_BENCHMARK = 'SPY';
```

Fetch 전략: 고유 섹터 ETF + SPY를 predict 실행 시 1회 병렬 fetch 후 캐시.

---

## 미구현 차트 패턴 12개 추가

| 패턴 | 방향 | 우선순위 |
|---|---|---|
| Pennant (Bullish) | 상승 | HIGH |
| Cup with Handle | 상승 | HIGH |
| 3 Rising Valleys | 상승 | HIGH |
| Ascending Scallop | 상승 | MEDIUM |
| Measured Move Up | 상승 | MEDIUM |
| Pennant (Bearish) | 하락 | HIGH |
| 3 Descending Peaks | 하락 | HIGH |
| Inverted Cup with Handle | 하락 | MEDIUM |
| Descending Scallop | 하락 | MEDIUM |
| Measured Move Down | 하락 | MEDIUM |
| Diamond Bottom | 반전(상) | MEDIUM |
| Tops Rectangle | 반전(하) | MEDIUM |

---

## 타입 변경 요약

```typescript
// 신규
interface InstitutionalConfig { enabled, weights, threshold, rsLookback, minAvgDailyDollarVol }
interface InstitutionalScore  { score, passed, components }

// PipelineConfig: institutional 추가, volumeSpike 제거
// PipelineResult.gateResults: institutional 추가
// evaluateSignal params: benchmarkPrices, avgDailyDollarVol, earningsBeat 추가
```

---

## 구현 순서

| # | 파일 | 작업 |
|---|---|---|
| 1 | `src/types/index.ts` | 신규 타입, volumeSpike 제거 |
| 2 | `src/constants.ts` | SECTOR_ETF_MAP, DEFAULT_INSTITUTIONAL_CONFIG |
| 3 | `src/services/institutional.ts` | 신규 — 6개 신호 계산 |
| 4 | `src/services/patterns.ts` | 12개 패턴 추가 |
| 5 | `src/services/pipeline.ts` | Gate 2.5 삽입, volumeSpike gate 제거, confidence 확장 |
| 6 | `src/services/data-fetcher.ts` | 벤치마크 캐시 fetch |
| 7 | `src/commands/predict.ts` | benchmarkPrices 전달 |
| 8 | `src/optimization/backtester.ts` | institutional 파라미터 연동 |
| 9 | `src/optimization/optimizer.ts` | InstitutionalConfig 탐색 공간 |
| 10 | `src/services/__tests__/institutional.test.ts` | 신규 단위 테스트 |
| 11 | `src/services/__tests__/patterns.test.ts` | 12개 패턴 케이스 |
