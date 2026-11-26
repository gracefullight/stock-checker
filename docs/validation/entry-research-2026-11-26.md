# Entry research — 2026-11-26

The shipped leader-pullback signal cannot be told apart from holding SPY
([forward check](leader-pullback-2026-10-06.md#forward-check-2026-11-25)), and
neither a different exit nor the market kill-switch changed that. This run
asked whether any other entry does better. Six families were measured, each
with rules and a pass bar written into its script before a result was read.
**None passed.** Nothing here changes the shipped configuration.

## Where the shipped signal's return comes from

The 157 replayed trades were split into stock selection and market timing
(`baseline.mjs`; intervals resample entry months, 2,000 times, seed 20261126).

| Measure over the same five-session windows | Mean net | Win rate |
|---|---:|---:|
| Shipped trades | +0.61% | 57.3% |
| SPY | +0.47% | 63.7% |
| Equal-weight configured universe | +0.70% | — |
| SPY, every five-session window since 2019-08-06 (1,833) | +0.16% | 58.1% |

Excess over SPY is +0.14% (−0.43…+0.70); over the equal-weight universe it is
−0.09% (−0.77…+0.53). The signal dates are good dates for the market as a
whole, about three times an ordinary window, and the chosen stocks add nothing
to them. The universe is today's ticker list, so its equal-weight return
(+0.37% per ordinary window against +0.16% for SPY) carries the hindsight that
SPY does not. Excess over SPY flatters every stock rule measured on it; the
equal-weight universe is the stricter benchmark.

## Protocol

- Stock rules use the frozen 2026-11-25 inputs (535 tickers, adjusted OHLCV,
  2018-10-04 to 2026-11-24), the next-open entry, 10 bps per round trip and
  one position per ticker. DEV is entries through 2023; TEST is 2024 onward.
- ETF rules use Yahoo adjusted OHLC for SPY (1993), QQQ (1999), DIA, IWM, MDY,
  the nine original sector SPDRs, SSO and QLD, fetched 2026-11-26 through the
  project client and kept under `data/strategy-validation/index-etfs-20261126`.
  ETFs carry no survivorship bias. DEV is entries through 2012; TEST is 2013
  onward (trend rule: DEV 2006-07 to 2015, TEST 2016 onward).
- A rule is chosen on DEV alone and run on TEST once. A family with no rule
  passing on DEV is not run on TEST.
- Intervals are 95% bootstrap intervals over entry months (weeks for the
  cross-sectional scan), because trades opened together share one market.

## Results

### 1. Event entries on the stock universe (`harness.mjs`, DEV only)

Twenty-session holds; 5, 10, 40 and 60 sessions agree in sign.

| Rule | Trades | Win rate | Mean net | Excess vs SPY | Excess vs equal-weight universe |
|---|---:|---:|---:|---:|---:|
| Advance ≥ 5% on ≥ 3× volume, strong close | 1,053 | 50.8% | +1.22% | +0.60% (−1.10…+2.46) | −1.83% (−7.17…+1.51) |
| 252-session closing high out of a 20-session base, ≥ 1.5× volume | 834 | 51.8% | +0.68% | −0.02% (−1.14…+1.31) | −3.42% (−8.46…−0.07) |
| Top decile by 12-1 month return, monthly, 21 sessions | 2,285 | 52.9% | +2.47% | +1.42% (−0.15…+3.06) | −0.28% (−2.88…+1.74) |

No rule beats the universe it selects from. Not run on TEST.

### 2. Cross-sectional features (`factors.mjs`, DEV only)

Top decile by each feature, rebalanced every five sessions, 212 weeks.

| Feature (bought) | Weekly excess vs universe | Weekly excess vs SPY |
|---|---:|---:|
| Five-session losers | +0.34% (−0.11…+0.83) | +0.44% (−0.14…+1.04) |
| 12-1 month momentum | +0.29% (−0.14…+0.68) | +0.38% (−0.10…+0.84) |
| 6-1 month momentum | +0.28% (−0.11…+0.65) | +0.37% (−0.07…+0.80) |
| 21-session losers | +0.17% (−0.30…+0.64) | +0.27% (−0.34…+0.87) |
| Low close in the day's range | +0.17% (−0.08…+0.41) | +0.26% (−0.08…+0.60) |
| 63-session strength vs sector | +0.12% (−0.22…+0.46) | +0.22% (−0.16…+0.59) |
| Below the 50-session average | +0.06% (−0.45…+0.56) | +0.15% (−0.48…+0.78) |
| Volume surge | +0.05% (−0.24…+0.33) | +0.14% (−0.25…+0.55) |
| Near the 252-session high | −0.11% (−0.47…+0.23) | −0.02% (−0.28…+0.24) |
| Low 21-session maximum return | −0.18% (−0.45…+0.10) | −0.08% (−0.27…+0.10) |
| Low 60-session volatility | −0.21% (−0.56…+0.14) | −0.11% (−0.34…+0.11) |

No interval leaves zero. Loser and momentum deciles are both inflated on a
list chosen with hindsight (failed losers and faded winners are absent), and
they still do not clear the bar. Not run on TEST.

### 3. Index pullbacks (`index.mjs`)

Three published rules (close in the lowest fifth of the day's range, RSI(2)
below 10, three lower closes), each with and without a 200-session trend
filter, with three exits, on SPY and QQQ. On DEV the open-after-a-close-above-
the-prior-high exit was positive for every rule on both ETFs. Three lower
closes had the highest lower bound across the two and was chosen:

| | SPY DEV | SPY TEST | QQQ DEV | QQQ TEST |
|---|---:|---:|---:|---:|
| Trades | 248 | 161 | 174 | 153 |
| Win rate | 73.4% | 65.2% | 74.7% | 67.3% |
| Mean net | +0.46% | +0.22% | +1.34% | +0.38% |
| Edge over the ETF's own drift | +0.45% (+0.19…+0.71) | +0.15% (−0.09…+0.37) | +1.47% (+0.89…+2.03) | +0.26% (−0.06…+0.58) |
| Account, cash when flat (CAGR) | 5.7% | 2.4% | 18.2% | 4.0% |
| Buy and hold (CAGR) | 8.0% | 14.1% | −1.9% | 18.6% |

TEST fails: both intervals include zero.

### 4. The same rule on fourteen ETFs (`replicate.mjs`)

The rule was left unchanged and compared with the same exit taken from the
open of every session of the same ETF ("any day").

| Pooled | DEV (2,486 trades) | TEST (2,268 trades) |
|---|---:|---:|
| Win rate | 69.2% | 65.7% |
| Edge over any day | +0.32% (+0.03…+0.58) | +0.04% (−0.18…+0.24) |
| Win-rate edge over any day | +4.8 pp (+1.4…+8.1) | +0.1 pp (−3.3…+3.5) |
| Excess over SPY, same window | +0.15% (+0.06…+0.23) | +0.01% (−0.08…+0.10) |

A 65.7% win rate is what this exit produces from any entry day (65.6%): it
sells into the first strong close, so most trades end slightly positive
whatever the entry. The edge that existed through 2012 is gone. A win rate
means nothing until it is set against the same exit on ordinary days.

### 5. Trend-gated exposure (`trend.mjs`, DEV only)

Hold while the index ETF closes above its 200-session average, else cash, at
1× and through the actual 2× funds.

| 2006-07 to 2015 | CAGR | Max drawdown | Sharpe |
|---|---:|---:|---:|
| SPY buy and hold | 7.1% | 55% | 0.44 |
| SPY, trend-gated | 5.0% | 25% | 0.49 |
| SSO (2×), trend-gated | 6.9% | 44% | 0.41 |
| QQQ buy and hold | 12.5% | 52% | 0.65 |
| QQQ, trend-gated | 8.1% | 23% | 0.61 |
| QLD (2×), trend-gated | 12.9% | 42% | 0.56 |

The gate halves the drawdown and gives up return. No vehicle has both a higher
CAGR and a Sharpe ratio at least as high as holding the index. Not run on TEST.

### 6. Sector momentum (`rotation.mjs`, DEV only)

Top three of nine sector SPDRs by trailing return, monthly.

| Lookback | Rotation | SPY | Nine sectors, equal weight | Monthly excess vs SPY |
|---|---:|---:|---:|---:|
| 3 months | +3.8% a year | +2.6% | +5.2% | +0.08% (−0.27…+0.43) |
| 6 months | +3.7% | +2.2% | +4.6% | +0.11% (−0.29…+0.50) |
| 12 months | +2.2% | +1.7% | +4.5% | +0.04% (−0.37…+0.45) |

Rotation trails simply holding all nine. Not run on TEST.

## What does change the result

Where the money sits between alerts decides the outcome, not the alerts
(`strategy:validate`, same frozen inputs and configuration `9d15fbda…`,
2019-08-06 to 2026-11-23):

| Account following every alert | Idle slots in cash (CAGR / max drawdown) | Idle slots in SPY (CAGR / max drawdown) |
|---|---:|---:|
| 1 slot | 3.2% / 44.5% | 14.9% / 41.3% |
| 3 slots | 3.2% / 13.3% | 15.3% / 34.5% |
| 5 slots | 2.3% / 8.1% | 14.8% / 34.2% |
| SPY buy and hold | — | 15.2% / 33.7% |

Each swap out of SPY and back pays a second 10 bps round trip. Kept in SPY
between alerts, the account matches the index within ±0.4 points a year; kept
in cash it earns a fifth of it. The alerts neither add to nor take from the
index.

## Conclusions

1. No entry rule measured here beats the index it would replace. The published
   index pullback effect did not survive 2013 onward on fourteen ETFs.
2. The alerts are a screener for names to look at, not a reason to hold cash
   while waiting for one. Capital belongs in the index; an alert is at most a
   swap out of it for five sessions.
3. Stock rules cannot be validated on the configured universe: it is a list
   chosen with hindsight, and no point-in-time membership or delisted price
   history is available. Any further stock research needs that data first.
4. The forward paper ledger remains the only out-of-sample evidence for the
   shipped signal. It held no closed observation on 2026-11-26.

## Reproduction

Scripts are in [`entry-research-2026-11-26/`](entry-research-2026-11-26/); price
data is not published. From the repository root, with the frozen inputs and the
ETF files in place:

```bash
node docs/validation/entry-research-2026-11-26/baseline.mjs
node docs/validation/entry-research-2026-11-26/harness.mjs
node docs/validation/entry-research-2026-11-26/factors.mjs
node docs/validation/entry-research-2026-11-26/index.mjs --final=down3/prior-high-10
node docs/validation/entry-research-2026-11-26/replicate.mjs
node docs/validation/entry-research-2026-11-26/trend.mjs
node docs/validation/entry-research-2026-11-26/rotation.mjs
```

`fetch-index.ts` downloads the ETF histories (see its header). `--final` prints
a TEST period; it was used once, for the rule named above. `replicate.mjs`
prints both periods by design. The remaining TEST periods were never printed.
