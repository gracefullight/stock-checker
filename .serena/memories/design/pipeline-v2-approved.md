# Signal Pipeline V2 — Approved Design Summary (2026-03-25)

## Approach: A+B Hybrid
- Multi-filter gate system + gradient scoring
- Target: 75% BUY 5-day directional win rate, 2-15 signals/month

## Pipeline: evaluateSignal() in src/services/pipeline.ts
1. Trend Gate (SMA50/SMA200) — blocks buying in downtrends
2. Gradient Scoring — continuous 0-1 weights replacing binary on/off
3. Confluence Check — minimum 4 of 6 indicators active
4. Reversal Confirmation — stateless, checks last 3 days for bullish candle + volume

## Key Design Decisions
- Stateless reversal confirmation (no cross-day persistence needed)
- Shared evaluateSignal() between predict.ts and backtester.ts (no logic duplication)
- PipelineConfig extends OptimizationParams with new tunable parameters
- Backtester performance: pre-compute indicator arrays, pass per-bar

## Design Doc: docs/plans/signal-pipeline-v2-design.md
## Review findings saved: design/pipeline-v2-review
