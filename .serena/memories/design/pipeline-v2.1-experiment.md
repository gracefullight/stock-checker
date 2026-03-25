# Pipeline V2.1 Experiment Summary (2026-03-25)

## 90% win rate attempt — NOT achieved
- Confidence gate: no improvement (removes good signals or no effect)
- Chart patterns: negative impact (60% vs 80% — adds noise)
- 80% is structural ceiling with price+volume only data

## Best config remains: noP Th=370, wide gradients, trend≥1, confluence≥3
- 80% win rate, 20 signals, +6.92% avg return, R/R 3.62

## Failures concentrated in 2024-04 (3/7 failed) — likely market event

## Infrastructure added:
- confidenceGate in PipelineConfig (disabled by default)
- detectPatterns() in backtester (enabled but patternWeights=0 recommended)
- backtest command with full experiment matrix
