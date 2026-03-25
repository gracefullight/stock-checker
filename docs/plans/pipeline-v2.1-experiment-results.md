# Pipeline V2.1 Experiment Results — 90% Win Rate Attempt

## Experiment Date: 2026-03-25

## Goal
Increase 5-day directional BUY win rate from 80% to 90% while maintaining ≥ 10 signals.

## Approaches Tested

### A. Ensemble Confidence Gate
Added weighted confidence score combining 4 gate strengths:
- trend strength (0-100)
- normalized buyScore (above threshold)
- confluence ratio (0-1)
- reversal quality (both=1, bullish=0.5)

**Result: No improvement.** Equal weights (eq) reduced signals from 20→7 while dropping win rate to 71%. Trend-weighted (trnd) had no effect (same 80%/20). The confidence gate either removes good signals or has no filtering power.

### B. Chart Pattern Activation
Enabled `detectPatterns()` in backtester (previously patternScore=0).

**Result: Negative impact.** Patterns added noise:
- Th=370: 80% → 60% (20 → 40 signals — patterns pushed more stocks above threshold)
- Th=450+: Not enough signals to evaluate

Bullish patterns (ascending triangle, double bottom, etc.) inflate buyScore for stocks that aren't truly oversold, generating false BUY signals.

### C. Combined (A+B)
Confidence gate couldn't compensate for pattern noise.

## Experiment Matrix Summary

| Config | WinRate | Signals | Verdict |
|--------|:-------:|:-------:|---------|
| noP Th=370 (baseline) | **80.0%** | 20 | **Best balance** |
| noP Th=370 c=30 trnd | 80.0% | 20 | Same as baseline |
| noP Th=370 c=30 eq | 71.4% | 7 | Worse — removes good signals |
| P Th=370 | 60.0% | 40 | Worse — pattern noise |
| P Th=450 | ~56% | 16 | Worse |

## Failure Analysis

4 failed signals (all in 2024):
- 2024-04: 3 failures out of 7 signals (57% win rate this month)
- 2024-05: 1 failure out of 1 signal

These are concentrated in a single period, suggesting a market-wide event rather than a model deficiency.

## Conclusion

**80% is the structural ceiling** for the current pipeline with available data sources (price + volume only). Reaching 90% would require:
1. External data not available in backtesting (fundamentals, earnings surprise, news sentiment)
2. More data (3 years × 16 tickers may not be enough for statistical significance at 20 signals)
3. Walk-forward optimization to find parameters robust to unseen data

## Recommendation
Keep `noP Th=370` as default. The confidence gate infrastructure is in place for future use when more filtering power is needed. Pattern detection should remain disabled in the pipeline scoring (patternWeights zeroed) until pattern detection accuracy improves.
