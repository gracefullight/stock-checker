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
| Leader pullback entry (주도주 눌림목) | `qualityGate` (Gate 1.7): `rsMin 0.7` + `requireBelowSma50` + `requireAboveSma200` + `ibs<0.3` + `atr%<3.5` + `volR>0.8` + `scoreMax 400` |
| Market kill-switch (essay #2 at the index level) | `qualityGate.requireMarketUptrend`: no BUY while the SPY Gaussian Channel is red (wired into `predict` via `marketUptrend`) |
| Anti-parabolic (don't chase) | `qualityGate.scoreMax` — extreme composite scores have the worst forward R/R |
| One setup, one decision | Setup-consumed cluster semantics (`PipelineResult.qualityBlocked`): a pullback that keeps closing weak for days is a breakdown, not an entry |
| Oscillators as seasoning only | institutional strategy caps oscillator contribution; flow components dominate |

## Validated results (don't regress these without a better backtest)

8y (entry years 2019–2026, incl. the 2020 COVID crash and the 2022 rate-hike
bear), 122-ticker diversified universe, fixed 5-day exit, real pipeline,
**net of a 10bps round-trip transaction cost** (a "win" = profitable after
costs; `mise run backtest -- --cost-bps=N` to vary):

- **V10 (shipped default — strong-leader pullback `rs≥0.7` + `scr<400` +
  market kill-switch + 200d stage filter): 71.7% WR / R/R 1.75 / N=46 /
  avgRet 1.86%** (train ≤2024: 72.5% / 1.51 / N=40; holdout ≥2025: 66.7% /
  N=6 — thin; by year: 2019 70% / 2020 60% / 2021 78% / 2022 67% / 2023 86% /
  2024 67% / 2025 75% / 2026 50% partial — every year ≥ 50%)
- The higher-N family member (`rs.7` + `scr<400` only, no market/stage filter):
  **69.7% / 1.58 / N=66**, holdout 69.2% on N=13, 2022 bear 64% on N=14 —
  statistically the sturdiest config; the shipped V10 adds two subtractive
  regime filters on top of it.
- V7 legacy gate (`rs.5`, `scr<380`): 61.3% / 1.52 / N=106. The single lever
  that lifted WR *without* giving back R/R was `rsMin 0.5 → 0.7` (essay #1 §5:
  "is it stronger than everything else?"); the market kill-switch added R/R
  (1.52 → 1.77 on the legacy gate) at roughly flat WR.
- V5 baseline (institutional, no gate): 52.2% / 1.09 (N=18,788)
- Essay-#2 trend-hold exit on the same entries: lower WR (41.5%) but R/R 2.6 —
  a different objective, kept as a documented option, not the default.
- Pre-cost 5y numbers previously here (65.1% / 1.36 / N=63) were measured
  gross on 2023–2026 only; the net 8y figures above supersede them.
- External cross-check: index-level regime filters raising pullback WR ~5pp
  and cutting drawdown roughly in half is consistent with published SPY
  mean-reversion backtests (QuantifiedStrategies 200d-MA filter: 76→81% WR,
  MDD 29→14%), while stock-level evidence is mixed (Decoding Markets) — which
  matches what we measured: the kill-switch's main gift is R/R, not WR.

## SELL signals are EXIT discipline, not downside predictions

Validated 2026-06 on the same universe (re-confirmed on the 8y window): SELL
signals (distribution day = heavy volume below VWAP + Donchian breakdown +
MACD dead cross) have **negative directional edge** — 45.2% 5-day accuracy vs
a 46.5% all-bars base down-rate, with +1.3%/5d and +4.2%/20d average forward
returns (N=555). Panic days mean-revert; nothing we tested (distribution days,
weak-RS subsets, Gaussian red-flips) predicts lower prices ahead with positive
edge in this universe. Even the 2022 bear year shows only 36.5% accuracy —
SELLs cluster on capitulation days that bounce.

Therefore:

1. **SELL never means "short this" or "price will fall".** It means *"the trend
   is broken and distribution is confirmed — holders should exit"* (essay #1 §8
   treats distribution as a holder's warning; essay #2's exit rule is the
   Gaussian flip).
2. The institutional pipeline **suppresses SELL inside an intact uptrend**
   (regime gate): selling leaders on a panic day is exactly the retail mistake
   essay #1 warns about. In the 2026 correction (broken-trend regime) the gated
   SELLs hit 76.9% — exit discipline works when it matters.
3. The validated position-exit discipline remains the V6/V8 trend-hold: ride
   the Gaussian green, exit on flip (or mid-cross) with a hard stop — R/R 2–3.5
   per trade cycle vs ~1.2 for fixed 5-day exits.

## Hard-won validation rules

1. **Post-hoc filters lie.** A filter applied to recorded signals overestimates the
   edge because blocking a buy changes the cluster window and lets different (often
   worse) bars fire. Always re-validate through `evaluateSignal`.
2. **Universe shapes conclusions.** Relative strength showed zero discriminating
   power on a tech-only universe (everything was the same high-beta bet) and became
   the top lever on a diversified one. Test levers on the universe you'll trade.
3. **Data window shapes conclusions.** A 2024-start window inflated win rates
   (strong bull regime). The backtest window is 8y so 2020 (crash) and 2022
   (bear) are full entry years; check per-year robustness and reject configs
   whose edge lives in one year or one regime.
4. **Train/holdout split** (≤2024 / ≥2025) before believing any searched config,
   and prefer stable *families* of configs over lone spikes.
5. **Costs are part of the edge.** Every backtested trade pays a 10bps
   round-trip cost (slippage on liquid large caps; zero commission), and a
   "win" means profitable net of that cost. A gate that only clears the bar
   gross is not an edge.
