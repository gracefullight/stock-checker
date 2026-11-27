# QLD volatility weight — 2026-11-27

A rule for the 2× Nasdaq-100 fund (QLD), separate from the stock signal:
hold more QLD when QQQ is calm and less when it is turbulent. On QLD's real
price history it returned more than holding QQQ with a smaller drawdown, in
2013–2026 and in 2006–2012. **The margin over QQQ is not statistically
distinguishable from zero, and the rule was picked after the first choice
failed.** It is available as `mise run qld`, labelled as a research rule.

## Rule (`qld-vol-target-v1`)

Signals use QQQ closes only. A weight decided on a close is traded at the next
open; the rest of the account is cash.

1. Target weight = min(100%, 20% ÷ (2 × QQQ's 20-session annualised
   volatility)). At 10% volatility the account is fully in QLD; at 20% it is
   half; at 40% a quarter.
2. Change the held weight only when the target is 10 points or more away.

There is no trend filter. The rule stays partly invested through a bear market
and relies on volatility rising as prices fall.

## How it was chosen

Four rules were registered in `qld.mjs` before any result was read: the
200-session average alone, the project's Gaussian filter alone, the volatility
weight alone, and the 200-session average combined with the volatility weight.
Cash earns 0% and each change of weight pays 5 bps on the amount traded.

1. **First protocol.** DEV was 2000–2012, with a synthetic 2× fund before QLD
   existed (twice QQQ's return minus 0.95% a year and the T-bill yield; it runs
   about a point a year above the real fund where they overlap). The rule to
   run on TEST was the highest CAGR among those with a DEV drawdown within 50%.
   Only the combined rule qualified (33%). On TEST (2013–2026, real QLD) it
   returned 16.0% a year against 18.3% for QQQ at the same 37% drawdown:
   **fail**.
2. **Second reading, at the owner's direction.** The synthetic years were set
   aside and the rules were judged on real QLD prices from 2013 with the same
   bar (CAGR above QQQ, drawdown within 1.25 times QQQ's). All four were then
   read on that period, so the choice among them is in-sample.
3. **Check on the years not used for that choice.** QLD's real history before
   2013 (2006-06 to 2012, which holds 2008) was read afterwards.

## Real QLD prices, 2013–2026

| | CAGR | Max drawdown | Sharpe | Worst session | Average weight | Changes a year |
|---|---:|---:|---:|---:|---:|---:|
| QQQ buy and hold | +18.3% | 37% | 0.91 | −10.7% | — | — |
| QLD buy and hold | +29.6% | 64% | 0.83 | −21.0% | 100% | — |
| SPY buy and hold | +13.9% | 32% | 0.89 | −8.8% | — | — |
| 200-session average | +23.2% | 47% | 0.80 | −21.0% | 85% | 4.5 |
| Gaussian filter | +15.8% | 60% | 0.61 | −21.0% | 79% | 3.2 |
| **Volatility weight** | **+20.1%** | **32%** | **0.92** | −14.3% | 66% | 19.2 |
| Average and volatility weight | +16.0% | 37% | 0.82 | −14.3% | 60% | 21.6 |

Bar: above 18.3% with a drawdown within 46%. The volatility weight passes. The
200-session average earns more and misses the drawdown limit by a point; it
holds full 2× exposure on the worst days.

## Real QLD prices, 2006-06 to 2012 (not used for the choice)

| | CAGR | Max drawdown | Sharpe | Worst session |
|---|---:|---:|---:|---:|
| QQQ buy and hold | +8.7% | 52% | 0.47 | −9.1% |
| QLD buy and hold | +7.9% | 82% | 0.40 | −17.2% |
| SPY buy and hold | +3.9% | 55% | 0.28 | −12.9% |
| **Volatility weight** | **+12.3%** | **41%** | **0.64** | −5.0% |

The same direction: more return than QQQ and a smaller drawdown, through 2008.
QLD itself fell 83% from its 2007 peak and did not regain it until March 2012.

## All of QLD's real history, 2006-06 to 2026-11

| | CAGR | Max drawdown | Sharpe |
|---|---:|---:|---:|
| QQQ buy and hold | +15.4% | 52% | 0.77 |
| QLD buy and hold | +22.8% | 82% | 0.69 |
| SPY buy and hold | +10.8% | 55% | 0.64 |
| Volatility weight | +18.0% | 41% | 0.85 |

Mean daily return over QQQ, annualised, with a bootstrap over calendar months:
+1.9% (−2.5…+6.2) for 2013–2026, +2.7% (−3.4…+9.3) for 2006–2012 and +2.3%
(−1.3…+5.9) for the whole real history. **Every interval includes zero.**

Rule against QQQ by calendar year (average QLD weight in brackets; years before
2007 use the synthetic fund):

| Year | Rule | QQQ | | Year | Rule | QQQ | | Year | Rule | QQQ |
|---|---:|---:|---|---|---:|---:|---|---|---:|---:|
| 2000 | −24% (22%) | −39% | | 2009 | +49% (47%) | +57% | | 2018 | −2% (63%) | −3% |
| 2001 | −20% (21%) | −32% | | 2010 | +28% (64%) | +20% | | 2019 | +39% (70%) | +43% |
| 2002 | −22% (27%) | −38% | | 2011 | +0% (57%) | +4% | | 2020 | +38% (46%) | +48% |
| 2003 | +41% (43%) | +48% | | 2012 | +28% (72%) | +19% | | 2021 | +32% (69%) | +27% |
| 2004 | +12% (61%) | +10% | | 2013 | +49% (83%) | +33% | | 2022 | −27% (36%) | −32% |
| 2005 | −8% (82%) | +2% | | 2014 | +23% (81%) | +20% | | 2023 | +55% (59%) | +52% |
| 2006 | +8% (69%) | +7% | | 2015 | −3% (68%) | +7% | | 2024 | +26% (64%) | +27% |
| 2007 | +16% (67%) | +18% | | 2016 | +6% (73%) | +10% | | 2025 | +19% (60%) | +21% |
| 2008 | −31% (36%) | −42% | | 2017 | +59% (92%) | +32% | | 2026 | −0% (55%) | −0% |

## Reading it

- The rule holds about 1.3 times QQQ's exposure on average and takes it down
  when volatility rises. Its Sharpe ratio from 2013 equals QQQ's (0.92 against
  0.91): the extra return is what the extra exposure pays, delivered with a
  shallower drawdown. It is a way to carry leverage more safely, not evidence
  of an edge.
- It gains most in calm advances (2013, 2017, 2010, 2012) and gives ground in
  sharp rebounds, when volatility is still high and the weight is still low
  (2009, 2019, 2020), and in choppy flat years (2005, 2015, 2016).
- It does not avoid bear markets. It lost 31% in 2008 and 27% in 2022, less
  than QQQ in both, and over 2000–2012 with the synthetic fund its drawdown
  reaches 60% against 83% for QQQ. A decline that begins quietly is carried at full
  weight until volatility catches up.
- It is still a leveraged fund. The worst session from 2013 cost 14.3% of the
  account, and drawdowns are measured on daily opens, so intraday lows were
  deeper. It changes weight about 19 times a year.
- The choice among four rules was made on 2013–2026 after the registered
  choice failed, and the margin over QQQ has an interval that spans zero in
  every period. The 2006–2012 check supports the direction; it does not turn
  this into a validated edge. Forward results are the test.

## Use

```bash
mise run qld
```

prints, for the latest completed QQQ session, the close, the 20-session
volatility, the target and the weight to hold from the next open. The replay
starts at QQQ's first session so the held weight matches this measurement. It
is not an order and nothing sends it anywhere. On the 2026-11-25 close QQQ's
volatility was 46.5%, the target 21.5%, and the held weight 21.4% QLD (last
changed 2026-11-23).

## Reproduction

```bash
(cd packages/core && bun ../../docs/validation/qld-strategy-2026-11-27/fetch.ts)
node docs/validation/qld-strategy-2026-11-27/qld.mjs --final=sma200+vol20
node docs/validation/qld-strategy-2026-11-27/qld.mjs --span=2013-01-02,2026-11-25
node docs/validation/qld-strategy-2026-11-27/qld.mjs --span=2006-06-22,2012-12-31
node docs/validation/qld-strategy-2026-11-27/qld.mjs --span=2006-06-22,2026-11-25
node docs/validation/qld-strategy-2026-11-27/qld.mjs --final=vol20
```

Price data is kept under `data/strategy-validation/qld-20261127` and is not
published. The first command is the registered run; `--span` prints every rule
over a span as description.
