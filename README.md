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
  back below its 50-day SMA — while still above its 200-day SMA and while the
  SPY Gaussian Channel is green (market kill-switch) — on a calm, weak-close
  bar with real participation. Backtested (8y incl. the 2020 crash and the
  2022 bear, 122 tickers, real pipeline, net of a 10bps round-trip cost):
  **71.7% 5-day win rate / 1.75 reward-risk** vs the 52.2% / 1.09 ungated
  baseline, every entry year ≥ 50%.
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
rate-hike bear), 122-ticker diversified universe, fixed 5-day exit, evaluated
through the real pipeline, **net of a 10bps round-trip transaction cost** (a
"win" = profitable after costs). Full context and hard-won validation rules in
[docs/TRADING_PRINCIPLES.md](docs/TRADING_PRINCIPLES.md).

| Config | WR (5d) | R/R | N | Avg ret/trade |
|---|---|---|---|---|
| **V10 — shipped gate** (`rs≥0.7` + `scr<400` + market kill-switch + 200d stage) | **71.7%** | **1.75** | 46 | 1.86% |
| `rs≥0.7` + `scr<400` only (higher-N family member) | 69.7% | 1.58 | 66 | 1.75% |
| V7 legacy gate (`rs≥0.5`, `scr<380`) | 61.3% | 1.52 | 106 | 1.17% |
| V5 institutional baseline (no quality gate) | 52.2% | 1.09 | 18,788 | 0.36% |

V10 by entry year (WR / N): 2019 70%/10 · 2020 60%/5 · 2021 78%/9 · 2022 67%/3 ·
2023 86%/7 · 2024 67%/6 · 2025 75%/4 · 2026 50%/2 — every year ≥ 50%.
Train ≤2024: 72.5% / 1.51 (N=40) · holdout ≥2025: 66.7% (N=6, thin).

Honest caveats: trade count is low (~6/yr) and the holdout split is thin, so
the higher-N family member above is the statistically sturdiest config; the
universe is defined as-of-today (survivorship bias), and there is no live
forward track record yet. The two regime filters only *remove* trades from the
validated base — they never add exposure.

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
