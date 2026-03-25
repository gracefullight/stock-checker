# Signal Pipeline V2 Design Review (2026-03-25)

## Design: A+B Hybrid (Multi-Filter Gate + Gradient Scoring)
Target: 75% directional win rate on 5-day BUY signals

## CRITICAL Issues
1. **Reversal confirmation gate needs statefulness** — current system is stateless. Solution: use last 2-3 days from existing historical data within single execution instead of cross-day state.
2. **SMA50/SMA200 not implemented** — trend gate depends on them but `calculateAllIndicators()` only has SMA20/EMA20.

## HIGH Issues
3. **Backtester duplicates scoring logic** — `Backtester.generateSignals()` has its own copy of opinion logic, won't reflect pipeline changes.
4. **Optimizer params incomplete** — new pipeline adds gradient ranges, confluence thresholds, trend gate params that aren't in OptimizationParams.
5. **All existing analysis tests will break** — 5 tests in analysis.test.ts test binary logic.

## MEDIUM Issues
6. Volume MA not computed, 7. Bollinger %B not computed, 8. CSV schema change, 9. MACD histogram gradient definition vague.

## Current Win Rate Baseline
- BUY 5-day: 49.8% (113/227)
- Score 200-249: 78.9% (19 signals)
- Jan 2026 (downtrend): 6.9%
- Reward/Risk ratio: 1.35
