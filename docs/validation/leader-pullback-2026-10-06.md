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

Maximum individual ticker-sleeve closing drawdown was **13.64%**. With $10,000
reserved for each of the 538 tickers, no capital reallocation or leverage, and
cash while flat, aggregate return was +0.1790% and aggregate maximum drawdown
was 0.07869%. Most capital stayed idle: the aggregate drawdown is diluted by
unused cash and does not represent the risk of an actively deployed strategy.
Costs are charged at exit; these marks do not measure intraday drawdown.

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
boundary purging, closing drawdown, snapshot freezing, worker/sequential parity,
and shared live/historical cluster consumption.
