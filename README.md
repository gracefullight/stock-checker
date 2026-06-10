# Stock Checker

A bun-workspaces monorepo that screens US equities with an institutional-flow
signal engine, visualizes them in a web UI, and validates every strategy change
with a backtest.

| Package | What it is |
|---|---|
| `packages/core` | Signal engine, backtest, and CLI (`predict` / `learn` / `optimize` / `backtest`) |
| `apps/api` | Fastify API server (screener, ticker detail, OHLCV) — port 5101 |
| `apps/web` | Next.js 16 screener UI (candlestick + Gaussian Channel band charts, portfolio, light/dark) — port 5100 |

| Screener | Ticker detail (Gaussian Channel band) |
|---|---|
| ![Equity screener table with composite scores, signals, and detected chart patterns](docs/images/screener.png) | ![TSLA detail page: candlestick chart with SMA 20/50/200, Bollinger Bands, and trend-colored Gaussian Channel band](docs/images/ticker-detail.png) |

## Signal philosophy

The engine follows the principles in [docs/TRADING_PRINCIPLES.md](docs/TRADING_PRINCIPLES.md):
price, volume, VWAP, moving averages, liquidity, relative strength, and earnings
revisions over oscillator soup.

- **Trend regime** — Gaussian Channel (green = uptrend, red = downtrend) gates all buys.
- **Institutional flow score** — relative strength vs SPY and the sector ETF,
  VWAP accumulation, breakout volume, dollar-volume liquidity, earnings revisions.
- **Strong-leader pullback entry (주도주 눌림목)** — BUY only when a name that
  is STRONGLY outperforming both the market and its sector (`rs ≥ 0.7`) pulls
  back below its 50-day SMA on a calm, weak-close bar with real participation.
  Backtested (8y incl. the 2020 crash and the 2022 bear, **408 tickers**, real
  pipeline, net of a 10bps round-trip cost): **59.1% 5-day win rate / 1.13
  reward-risk / N=279** vs the 51.6% / 1.03 ungated baseline (z≈2.5, p≈0.006).
- **SELL = exit discipline, not a downside prediction** — distribution-day
  SELLs are suppressed inside intact uptrends and only fire when the trend
  itself is broken.
- Classic indicators (RSI, Stochastic %K, Bollinger, Donchian, Williams %R,
  MACD, ATR, volume ratio, Fear & Greed) are still computed and displayed, but
  they season the score rather than drive it.
- Volatility-adjusted risk levels per signal: 1.5×ATR stop loss, 2× reward
  take profit, trailing stop that activates after a 0.5×ATR move.

## Validated results

8-year window (entry years 2019–2026, incl. the 2020 COVID crash and the 2022
rate-hike bear), **408-ticker** diversified universe, fixed 5-day exit,
evaluated through the real pipeline, **net of a 10bps round-trip transaction
cost** (a "win" = profitable after costs). Full context and hard-won
validation rules in [docs/TRADING_PRINCIPLES.md](docs/TRADING_PRINCIPLES.md).

| Config | WR (5d) | R/R | N | Avg ret/trade |
|---|---|---|---|---|
| **Shipped gate** (`rs≥0.7` + `scr<400` + below-50d pullback) | **59.1%** | **1.13** | 279 | 0.81% |
| Legacy V7 gate (`rs≥0.5`, `scr<380`) | 57.3% | 1.22 | 419 | 0.79% |
| Shipped gate + SPY kill-switch + 200d stage (NOT shipped) | 56.5% | 1.09 | 191 | 0.57% |
| V5 institutional baseline (no quality gate) | 51.6% | 1.03 | 65,698 | 0.17% |

Shipped gate by entry year (WR / N): 2019 67%/45 · 2020 50%/26 · 2021 63%/38 ·
2022 56%/59 · 2023 47%/36 · 2024 55%/20 · 2025 67%/33 · 2026 68%/22.
Train ≤2024: 57.1% / 1.05 (N=224) · holdout ≥2025: 67.3% / 1.67 (N=55).
The edge over baseline is statistically significant (z≈2.5, p≈0.006).

**Falsification record.** On the original 122-ticker growth-heavy universe the
same family printed up to **71.7% WR / 1.75 R/R (N=46)** — expanding the
universe 3.3× collapsed it to the table above. The 70%+ readings were small-N
universe artifacts, not edge ("universe shapes conclusions"). The SPY-Gaussian
market kill-switch helped at 122 tickers and consistently *hurt* at 408, so it
ships as an optional gate param, off by default. Remaining caveats: as-of-today
universe (survivorship bias), no live forward track record.

## Usage

Tooling is managed by [mise](https://mise.jdx.dev); tasks wrap every common
operation (run `mise tasks` to see them all).

```bash
mise install        # pin runtimes (node 24, bun)
bun install         # install workspace deps + git pre-commit hook
mise run dev        # API (5101) + Web (5100) dev servers in parallel
```

### Environment (optional)

| Variable | Effect |
|---|---|
| `TIINGO_API_KEY` | Enables the [Tiingo](https://www.tiingo.com) daily-OHLCV fallback when Yahoo is rate-limited or down (free tier: 1,000 req/day). Without it, OHLCV degrades to empty on Yahoo failure. |
| `SLACK_WEBHOOK_URL` | Slack notification for BUY/SELL opinions from `predict`. |

### CLI (packages/core)

```bash
# Daily prediction for a ticker list (default command)
mise run predict -- --ticker=TSLA,PLTR --sort=asc

# Slack notification for BUY/SELL opinions (either form)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX mise run predict -- --ticker=TSLA,PLTR
mise run predict -- --ticker=TSLA,PLTR --slack-webhook=https://hooks.slack.com/services/XXX

# Strategy validation & tuning
mise run backtest        # version comparison, goal search, SELL validation
mise run backtest -- --cost-bps=20   # vary the round-trip cost (default 10bps)
mise run backtest -- --quick         # stop after version comparison + gate tuning
mise run optimize        # parameter optimizer (positional symbol, e.g. TSLA)
mise run learn           # learn from prediction feedback
```

Each `predict` run appends rows to a monthly CSV in `packages/core/public/`
(e.g. `stock_data_202511.csv`), tickers in alphabetical order (`--sort=desc`
reverses).

### Quality gate

```bash
mise run ci          # lint → typecheck → test → build
```

## Automation

- `.github/workflows/daily-data.yml` — runs `predict` after US market close and
  auto-commits the monthly CSV.
- `.github/workflows/weekly-optimize.yml` — weekly parameter optimization,
  results uploaded as a build artifact.
