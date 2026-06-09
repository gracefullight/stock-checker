# Trading Principles (SSOT for signal design)

Two essays define this project's signal philosophy. **Every algorithm change must
be justified against these principles and validated by backtest through the real
pipeline** (post-hoc filters have repeatedly overestimated edges).

## Essay #1 — Institutional flow (기관 수급)

Complex oscillators are derivatives of price and volume; what moves price is money.
The only question that matters: **is real money flowing into this name, and is that
flow structural (earnings-linked) or just thematic?**

What matters, in order:

1. **Price vs key MAs** — 20/50/200d as average cost basis of participants, not magic
   lines. What matters is the *reaction* at the line (volume drying up on pullback =
   healthy; volume exploding through the line = liquidation).
2. **VWAP** — institutions execute against it. Holding above VWAP *with volume* means
   the market keeps absorbing supply above the day's average price.
3. **Volume vs average** — price can lie; volume less so. Multiples of average volume
   on a move = the market's attention changed.
4. **Liquidity** — institutions need exit-able dollar volume. Good story without
   liquidity stays orphaned; the re-rating starts when dollar volume opens up.
5. **Relative strength** — leaders fall less, bounce first, make new highs first,
   *within and across sectors*. "Did it rise?" is the wrong question; "is it stronger
   than everything else?" is the right one.
6. **New highs / box breakouts** — quality breakouts (with estimate revisions +
   volume) mean prior supply is gone. Fear of highs is a retail bias. But parabolic,
   story-only extension is not an entry.
7. **Earnings estimate revisions** — big trends come from rising estimates, not
   low multiples. The consensus inflection is the moment that matters.
8. **Price reaction > news** — markets respond to result-vs-expectation, not the
   news' absolute value.
9. **Short interest** — matters only when the short thesis is *breaking*.
10. **Index inclusion / passive flows, option flow** — supplementary supply-demand
    events; never standalone signals.

## Essay #2 — Trend (Gaussian Channel)

A chart is just agreed prices arranged in time. The one thing worth a dedicated
indicator is **trend persistence**, and the most efficient tool is the **Gaussian
Channel**: green band = uptrend, red = downtrend. Buy-side activity belongs in
green (or at the red→green flip). MAs, volume, VWAP, trend, support/resistance —
plus RSI/MACD only as seasoning. RSI is *not* important.

## How the system implements this

| Principle | Implementation |
|---|---|
| Gaussian trend regime | `trendGate.source: 'gaussian'` (pipeline Gate 1); chart band in web UI |
| Relative strength (market & sector) | `institutional.components.rsSpy/rsSector` vs SPY + sector ETF |
| VWAP / breakout volume / liquidity / earnings | institutional flow score components (blended, not hard-gated) |
| Leader pullback entry (주도주 눌림목) | `qualityGate` (Gate 1.7): `rsMin 0.5` + `requireBelowSma50` + `ibs<0.3` + `atr%<3.5` + `volR>0.8` + `scoreMax 380` |
| Anti-parabolic (don't chase) | `qualityGate.scoreMax` — extreme composite scores have the worst forward R/R |
| One setup, one decision | Setup-consumed cluster semantics (`PipelineResult.qualityBlocked`): a pullback that keeps closing weak for days is a breakdown, not an entry |
| Oscillators as seasoning only | institutional strategy caps oscillator contribution; flow components dominate |

## Validated results (don't regress these without a better backtest)

5y (2023–2026), 121-ticker diversified universe, fixed 5-day exit, real pipeline:

- **V7 (institutional + leader-pullback gate): 65.1% WR / R/R 1.36 / N=63**
  (by year: 2023 71.4% / 2024 66.7% / 2025 75.0% / 2026 58.3% partial)
- V5 baseline (institutional, no gate): 52.5% / 1.09
- Essay-#2 trend-hold exit on the same entries: lower WR (~40-50%) but R/R 2-3 —
  a different objective, kept as a documented option, not the default.

## Hard-won validation rules

1. **Post-hoc filters lie.** A filter applied to recorded signals overestimates the
   edge because blocking a buy changes the cluster window and lets different (often
   worse) bars fire. Always re-validate through `evaluateSignal`.
2. **Universe shapes conclusions.** Relative strength showed zero discriminating
   power on a tech-only universe (everything was the same high-beta bet) and became
   the top lever on a diversified one. Test levers on the universe you'll trade.
3. **Data window shapes conclusions.** A 2024-start window inflated win rates
   (strong bull regime). Include 2023+ and check per-year robustness; reject
   configs whose edge lives in one year.
4. **Train/holdout split** (≤2024 / ≥2025) before believing any searched config,
   and prefer stable *families* of configs over lone spikes.
