# Leader-pullback remeasurement — 2026-10-06

CLI, API/web, MCP, screening, and backtests now resolve the same complete
leader-pullback configuration. Histories with at least 210 sessions use the same
causal signal evaluator and prior BUY/quality-blocked cluster state.
This run recalculated signals from frozen raw OHLCV; it did not reuse old signals
or tune parameters.

## Coverage and execution

- Requested universe: 555 configured tickers; evaluated: 538; unavailable: 17.
- Raw session dates: 2018-10-04 through 2026-10-02; 205 bars of indicator warmup.
- Realized entries: 2019-08-06 through 2026-09-09; final exit: 2026-09-15.
- Entry: next session open after a completed BUY signal.
- Exit: fifth entry session close, counting entry as session one.
- Round-trip cost: 10 bps. A win has a strictly positive net return.
- BUY observations may overlap. Executed trades allow one long position per
  ticker and use the same fixed hold. The cluster gap remains five calendar days.

## Results

| Entry period | BUY observations: wins / samples | Win rate | Non-overlapping trades: wins / trades | Win rate | Mean net trade return |
|---|---:|---:|---:|---:|---:|
| Full period | 89 / 156 | 57.05% | 89 / 155 | 57.42% | +0.63% |
| Before 2025 | 61 / 116 | 52.59% | 61 / 115 | 53.04% | +0.29% |
| From 2025 | 28 / 40 | 70.00% | 28 / 40 | 70.00% | +1.60% |

The 2025 boundary excludes pre-boundary entries whose exits cross into 2025;
this dataset required zero exclusions. The 2025 onward period had already been
examined. These are descriptive remeasurement results, **not independent
out-of-sample validation or a future win probability**.

| Entry year | BUY observations | Win rate | Non-overlapping trades | Win rate |
|---|---:|---:|---:|---:|
| 2019 | 8 / 14 | 57.14% | 8 / 14 | 57.14% |
| 2020 | 6 / 11 | 54.55% | 6 / 11 | 54.55% |
| 2021 | 15 / 27 | 55.56% | 15 / 27 | 55.56% |
| 2022 | 14 / 30 | 46.67% | 14 / 30 | 46.67% |
| 2023 | 8 / 17 | 47.06% | 8 / 16 | 50.00% |
| 2024 | 10 / 17 | 58.82% | 10 / 17 | 58.82% |
| 2025 | 12 / 15 | 80.00% | 12 / 15 | 80.00% |
| 2026 | 16 / 25 | 64.00% | 16 / 25 | 64.00% |

There were no realized observations in 2018. Net mean returns were negative in
2019, 2022, and 2023. The recent 70% slice does not establish consistent
performance across regimes.

## Matched benchmarks

Every strategy figure above is absolute. The same money earns something on the
same sessions without any stock selection, so the report now measures the
executed trades against SPY over the same entry-open to exit-close windows
(remeasured 2026-10-14 on the same frozen inputs; the 157 / 155 / +0.63%
baseline is unchanged, configuration SHA-256 `9d15fbda…`).

| Measure | Strategy (155 trades) | SPY, same windows | Note |
|---|---:|---:|---|
| Mean net return per trade | **+0.63%** | +0.58% gross, +0.48% net | same 10 bps charged to SPY |
| Win rate | 57.4% (Wilson 95%: 49.5–64.9%) | 63.2% | SPY wins more often on these dates |
| Mean excess vs SPY | +0.05% vs gross, +0.15% vs net | — | bootstrap 95%: −0.48…+0.58 (gross), −0.38…+0.68 (net); seed 20261006, 2,000 resamples |
| Trades beating SPY | 54.8% (85 / 155) | — | |
| Mean net, bootstrap 95% | +0.04…+1.22 | — | trades resampled as independent |

Interpretation: the per-trade result cannot be told apart from holding SPY on
the same dates. The strategy is an **overlay**, not a stock-selection edge
distinguishable from the index in-sample. Same-day entries share one market
window, so the true intervals are wider than shown.

| Diagnostic | Value |
|---|---|
| Cost sensitivity (mean net / WR) | 10 bps +0.63% / 57.4%; 20 bps +0.53% / 57.4%; 30 bps +0.43% / 55.5% |
| Exposure | positions open on 482 of 1,787 SPY sessions (27.0%); 110 distinct entry sessions; at most 7 concurrent |
| MAE (entry open to lowest low) | mean −3.08%, median −2.34%, worst decile −6.54% |
| MFE (entry open to highest high) | mean +3.29%, median +2.79%, best decile +6.50% |
| Entry price tiers (adjusted) | <$10: 1 trade; $10–50: 34 (+1.17%, 52.9%); $50–200: 77 (+0.25%, 54.5%); ≥$200: 43 (+0.75%, 65.1%) |
| 20-session dollar volume tiers | <$50M: 6 (−0.66%); $50–200M: 51 (+0.75%); $200M–1B: 87 (+0.51%); ≥$1B: 11 (+1.71%) |

All win-rate tiers overlap at 95%; no price or liquidity effect is established,
and the sample holds essentially no low-priced names.

### Single-account simulation

The former 538-sleeve aggregate (+0.18% on $5.38M of mostly idle capital) was
replaced by one $10,000 account split into K equal cash slots. A trade is taken
only when a slot is free at its entry open, in entry-date then ticker order;
idle slots hold cash; positions are marked at session closes; costs are charged
at exit. Span: 2019-08-06 to 2026-09-15 (1,787 sessions).

| Account | Trades taken / skipped | Total return | CAGR | Max drawdown (closes) |
|---|---:|---:|---:|---:|
| K = 1 | 90 / 65 | +27.0% | 3.4% | 44.5% |
| K = 3 | 142 / 13 | +26.4% | 3.3% | 13.3% |
| K = 5 | 152 / 3 | +18.4% | 2.4% | 8.1% |
| SPY buy and hold, same span | — | +193.3% | 16.3% | 33.7% |

Following the alerts with idle cash never approached SPY over this span. Idle
capital belongs in the index; the alerts only make sense as an overlay on it.

### Selection provenance

The shipped quality gate was not chosen by this measurement. It came from a
research grid of up to 544,320 filter configurations applied to recorded
signals and ranked by training-period win rate (`backtest --research`, which
now logs `trialsEvaluated`). Ranking that many candidates on raw win rate
biases the chosen gate's in-sample numbers upward, and the selection cannot be
separated from later execution fixes. The report records
`selection.trialsEvaluated = 1` for this run because no search ran; in-sample
numbers from the searched period cannot support an edge claim. The forward
paper ledger (`market-screen-performance`) is the only out-of-sample evidence
and is judged against SPY on the same sessions.

The current surviving ticker universe and sector mappings carry selection and
survivorship bias. This evaluates SC BUY rules on the configured universe;
historical Finviz volume rankings and its candidate cap were not reconstructed.
Historical point-in-time earnings and estimate revisions are
unavailable. Live earnings evidence applies only to the latest bar. Parity
requires the same available history and benchmarks; shorter live histories use
an unvalidated fallback. Fixed holds do not test ATR stop/target execution.

## Reproduction

The [complete measured v3 configuration](leader-pullback-2026-10-06.config.json)
is tracked. Locally preserved raw inputs and the full JSON report are ignored
under `data/strategy-validation/`; price data is not published with the code.

From the repository root, using the preserved local inputs and measured source:

```bash
mise run strategy:validate -- \
  --dataset="$PWD/data/strategy-validation/leader-pullback-20261006-inputs" \
  --config="$PWD/docs/validation/leader-pullback-2026-10-06.config.json" \
  --output="$PWD/data/strategy-validation/recheck.json" \
  --workers=6
```

Compatible datasets contain chronological `<TICKER>.json`, `SPY.json`, sector
ETF OHLCV files, and `range.json` with ISO `start`/`end`. The command freezes raw
files, universe, configuration, requested session bounds, and working-tree source
hashes before evaluation. Source changes during a run invalidate its result.
No market requests or notifications occur.

- Measured source commit: [7f687c9](https://github.com/gracefullight/stock-checker/commit/7f687c92e1e701f1af0d0b8c457cae627ec0f7d5).
  Release commits can change the lockfile fingerprint without changing the signal engine.
- Frozen at: `2026-10-06T04:03:00.408Z`; completed at: `2026-10-06T04:04:38.523Z`.
- Config SHA-256: `9d15fbdaa4a0b607e6de440bf05d6584d3b855c2f93a53de5854b3a2fa5338cb`.
- Input/universe/range fingerprint: `991287c9d112767aefbcbae9207248244e20f6cec86de32a6b02aba66958ff04`.
- Working-tree source SHA-256: `b58cb6cd7750a187d0fc33c32a8fb1b837babf50631e9c08639fc6967ca1071f`.
- Source changed during measurement: `false`. Coverage status: `partial`.

Missing inputs: BK, CFLT, CMA, CTRA, CYBR, EXAS, FI, GPS, LC, MMC, PSTG, SNV, SQ.
Insufficient history: AVB, EA, EQR, IAS. No eligible evaluation failed.

Offline regressions cover next-open costs, overlapping versus executed trades,
boundary purging, matched SPY windows with the seeded bootstrap and Wilson
interval, cost sensitivity, exposure, MAE/MFE, price and dollar-volume tiers,
the K-slot account beside SPY buy-and-hold, snapshot freezing,
worker/sequential parity, and shared live/historical cluster consumption.
