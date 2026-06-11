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
| Leader pullback entry (주도주 눌림목) | `qualityGate` (Gate 1.7): `rsMin 0.7` + `requireBelowSma50` + `ibs<0.2` + `atr%<3.5` + `volR>0.8` + `scoreMax 400` |
| Market kill-switch (essay #2 at the index level) | `qualityGate.requireMarketUptrend` (optional, OFF by default — helped on 122 tickers, hurt at 408; wired into `predict` via `marketUptrend`) |
| Anti-parabolic (don't chase) | `qualityGate.scoreMax` — extreme composite scores have the worst forward R/R |
| One setup, one decision | Setup-consumed cluster semantics (`PipelineResult.qualityBlocked`): a pullback that keeps closing weak for days is a breakdown, not an entry |
| Oscillators as seasoning only | institutional strategy caps oscillator contribution; flow components dominate |

## Validated results (don't regress these without a better backtest)

8y (entry years 2019–2026, incl. the 2020 COVID crash and the 2022 rate-hike
bear), **546-ticker** diversified universe (large/mid/small, all 11 sectors),
fixed 5-day exit, real pipeline, **net of a 10bps round-trip transaction
cost** (a "win" = profitable after costs; `mise run backtest -- --cost-bps=N`
to vary):

- **Shipped gate (strong-leader deep pullback `rs≥0.7` + `ibs<0.2` +
  `scr<400` + below-50d): 60.4% WR / R/R 1.28 / N=225 / avgRet 1.08%** —
  train ≤2024: 58.6%/1.19 (N=186), holdout ≥2025: 69.2%/2.35 (N=39); by year:
  2019 66% / 2020 62% / 2021 61% / 2022 55% / 2023 52% / 2024 55% / 2025 65% /
  2026 74% — every entry year ≥ 50% including both bears. Significant vs
  baseline (z≈2.6, p≈0.004). The `ibs` lever improved monotonically
  (0.3 → 0.25 → 0.2) on every universe tested — a deep intraday flush, not a
  mild dip, is what gets paid.
- V7 legacy gate (`rs.5`, `ibs.3`, `scr<380`): 56.3% / 1.32 / N=476.
- V5 baseline (institutional, no gate): 51.3% / 1.05 (N=84,541)
- **Cap-tier scope: large-cap strategy.** ~90% of gate signals are $10B+
  names. Mid caps: gate fires rarely, no WR edge (≈52% vs 50.5% baseline,
  N=25), winners run bigger (R/R ~1.7-1.9). Small caps: the ungated pullback
  baseline is negative (46.1% WR, −0.07%/trade, N=2,220) — do not buy
  small-cap pullbacks with this system.
- Essay-#2 trend-hold exit: lower WR but higher R/R per cycle — a different
  objective, kept as a documented option, not the default.

### Falsification record (2026-06, the 75%-greed episode)

On the original 122-ticker growth-heavy universe, the rs.7 family printed
**66–72% WR / R/R 1.45–1.75** (N=46–66, train/holdout both confirming), and
the SPY-Gaussian market kill-switch + 200d stage filter looked WR/R-R
dominant (71.7%/1.75). Expanding the universe 3.3× to 408 tickers collapsed
all of it: the same configs measured 54–59% WR / R/R ≈1.1, and every
+kill-switch variant did WORSE than its sibling (59.1%→55.7%). Lessons,
now codified:

1. Rule #2 (universe shapes conclusions) applies to WIN RATES, not just
   lever selection — a WR claim is only as broad as the universe it was
   measured on. Hand-picked growth universes inflate pullback win rates.
2. Index-level regime filters transfer poorly to individual-stock entries —
   consistent with the published split evidence (QuantifiedStrategies SPY
   76→81% WR with a 200d filter vs Decoding Markets finding no stock-level
   benefit). `requireMarketUptrend` / `requireAboveSma200` stay available as
   gate params, OFF by default.
3. Realistic ceiling: at N in the hundreds, the leader-pullback edge at a
   5-day fixed exit is **~56–60% WR with R/R ~1.2–1.3** in this universe
   class (60.4% with the deep-flush `ibs<0.2` gate). 70%+ WR claims at N<100
   should be treated as unvalidated.
4. Cap tiers are not interchangeable: the same gate that clears 60% on large
   caps has no hit-rate edge on mids and the raw pullback is a losing trade
   on smalls. A win-rate claim carries a universe AND a cap tier.
- Pre-cost 5y numbers previously here (65.1% / 1.36 / N=63) were measured
  gross on 2023–2026 only; superseded twice since (costs+8y, then 408-ticker
  universe).

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
