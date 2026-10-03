# Stock Checker

A bun-workspaces monorepo that screens US equities with an institutional-flow
signal engine, visualizes them in a web UI, and evaluates strategies against
historical data.

| Package | What it is |
|---|---|
| `packages/core` | Signal engine, backtest, and CLI (`predict` / `learn` / `optimize` / `backtest`) |
| `apps/api` | Fastify API server (screener, ticker detail, OHLCV) — port 5101 |
| `apps/web` | Next.js 16 screener UI (candlestick + Gaussian Channel band charts, portfolio, light/dark) — port 5100 |
| `apps/mcp` | Local stdio MCP for stock analyst reports in Codex and Claude Code |

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
- **Strong-leader pullback entry (주도주 눌림목)** — the current rules require
  strong relative strength against both SPY and the ticker's sector, a calm
  pullback below the 50-day SMA, and a close near the bar's low. Missing or
  mismatched benchmark dates provide no relative-strength evidence.
- **SELL = exit discipline, not a downside prediction** — distribution-day
  SELLs are suppressed inside intact uptrends and only fire when the trend
  itself is broken.
- Classic indicators (RSI, Stochastic %K, Bollinger, Donchian, Williams %R,
  MACD, ATR, volume ratio) supplement the flow score. Bitcoin Fear & Greed is
  displayed separately and excluded from equity decisions.
- Volatility-adjusted risk levels per signal: 1.5×ATR stop loss, 2× reward
  take profit, trailing stop that activates after a 0.5×ATR move.

## Performance validation status

The previous **60.4% win rate / 1.28 reward-risk** figures are withdrawn as
validation of the current implementation. The finance audit found next-session
information in historical benchmark inputs, same-close entries after close-based
signals, inconsistent indicators and corporate-action adjustments, and a
holdout period reused to rank candidate configurations. The archived figures in
[docs/TRADING_PRINCIPLES.md](docs/TRADING_PRINCIPLES.md) describe exploratory
runs of the previous implementation.

The corrected fixed-hold evaluator enters at the next session's open, exits after
five trading sessions including the entry session, and charges 10 bps per round
trip. The equity curve marks open positions at each daily close, including
intervening losses. Signal statistics can include overlapping observations;
the single-position equity curve accepts only non-overlapping trades. Its
maximum drawdown uses daily closing marks and does not measure intraday losses.

Historical OHLC fields use the same split/dividend-adjusted scale when the
provider supplies adjustment data. Bitcoin Fear & Greed is displayed as Bitcoin
sentiment and contributes no evidence to US equity signals. Estimate revisions
compare the same forecast period over time, rather than different quarters.
BUY/SELL/HOLD percentages are score weights, not proven trade-success probabilities.

The learning evaluator compares consistently adjusted daily closes over five
subsequent observed trading sessions. Its ±2% BUY/SELL hit rate measures direction,
and its fitted Brier score is in-sample; neither measures executed net profit.

A new broad-universe, cost-adjusted, untouched out-of-sample evaluation is required
before publishing a performance claim. Current ticker/sector mappings still carry
survivorship and classification bias, and historical earnings information is not
available as a point-in-time series. Live snapshots also lack the historical
engine's cluster state, so repeated BUY displays are not separate backtested
entries. The code fixes have regression coverage;
they do not establish a profitable strategy.

## Usage

Tooling is managed by [mise](https://mise.jdx.dev); tasks wrap every common
operation (run `mise tasks` to see them all).

```bash
mise install        # install node 26, bun, Python 3.14, and uv
mise run install    # install workspace deps + repository git hooks
mise run dev        # API (5101) + Web (5100) dev servers in parallel
```

Check and update workspace dependencies with `mise run deps:outdated` and
`mise run deps:update`. The updater visits each workspace sequentially so they
share one lockfile. Type checks use the TypeScript 7 native `tsc`; the
`typescript` import uses the official [TypeScript 6 compatibility package](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0) for
tools such as Next.js that need the JavaScript compiler API.

The app and its optimizer run in TypeScript. The managed financial-analysis
skills use Python. Their dependencies are locked separately in
`tools/finance/uv.lock` and run with Python 3.14:

```bash
mise run finance:install
mise run finance:deps:outdated
mise run finance:deps:update
mise run finance:lint         # Ruff lint
mise run finance:format:check # Ruff formatting check
mise run finance:fix          # safe lint fixes, then formatting
mise run finance:typecheck    # Pyrefly, targeting Python 3.14
mise run finance:test         # offline regression tests
mise run finance:run -- .codex/skills/stock-analysis/scripts/analyze_stock.py --help
mise run finance:run -- .codex/skills/backtesting-trading-strategies/scripts/backtest.py --help
```

`finance:run` invokes Python inside the locked project environment, including
for scripts with inline uv metadata.
`mise run lint` includes Ruff lint and formatting checks, `mise run typecheck`
runs Pyrefly, and `mise run test` includes the Python regressions. These checks
also run in GitHub Actions when the finance dependencies or scripts change.

The pre-commit hook checks staged file contents with Biome and leaves file contents
and staging unchanged. Fix reported issues and stage the changes before retrying
the commit. The commit-message hook checks co-author addresses against the
repository allowlist.

### Environment (optional)

| Variable | Effect |
|---|---|
| `TIINGO_API_KEY` | Enables the [Tiingo](https://www.tiingo.com) daily-OHLCV fallback when Yahoo is rate-limited or down (free tier: 1,000 req/day). Without it, OHLCV degrades to empty on Yahoo failure. |
| `SLACK_WEBHOOK_URL` | Slack notification for BUY/SELL opinions from `predict`. |
| `FMP_API_KEY` | Optional [FMP](https://site.financialmodelingprep.com/developer/docs) fallback for recent individual analyst price-target updates. Yahoo consensus and available Yahoo target updates work without it. |
| `STOCK_CHECKER_DASHBOARD_URL` | Base URL for the local MCP browser dashboard tool; defaults to `http://localhost:5100`. Accepts HTTP/HTTPS without credentials, query parameters, or fragments. |

### Local MCP (Codex and Claude Code)

After `mise install` and `mise run install`, reopen the client in this repository.
The project configurations register `stock_checker` through
`.codex/config.toml` for [Codex](https://developers.openai.com/codex/mcp/)
and `.mcp.json` for Claude Code. Executables and source paths are portable;
no personal interpreter path is stored in the repository.

Ask the client, for example: `TSLA 분석해줘. 근거, 승률, 진입, 손절, 최근 목표가까지.`
It can call `analyze_stock` with:

```json
{"ticker":"TSLA","lookbackDays":2920}
```

The tool returns Markdown and structured data: current signal and gate reasons,
ATR risk reference prices, conditional next-session entry, historical five-session
net win rate, stop/target touch rates, available analyst targets, and PER/PSR
valuation. Lookback is bounded to 730–3650 calendar days. `mise run mcp` starts the server directly;
stdout carries JSON-RPC and logs go to stderr.

Historical rates include observation counts, dates, and execution assumptions.
They are empirical frequencies, not calibrated forecasts. The fixed-hold win
rate charges 10 bps round trip; stop/target statistics are measured separately.
Same-bar stop/target hits have unknown ordering and are reported as ambiguous.
An empty sample produces an unavailable rate. Historical signals still carry
the earnings, universe, and cluster-state limitations described above.

Analyst consensus and individual updates have separate source/date metadata.
Recent updates cover the last 90 days, with a 30-day count; a retrieved consensus
is not presented as a newly published analyst report. Analyst targets have a
different horizon from the five-session trade statistics. Missing data or provider
access is reported explicitly. Supply optional keys in the client's environment.

Valuation includes the stock's trailing PER and PSR, separate forward PER,
and medians from up to 12 Yahoo-selected US-region companies in the same industry.
The subject stock, duplicates, non-equities, and industry mismatches are excluded.
Each median requires at least three positive, finite peer values; missing data
returns `null`, and losses make trailing PER unavailable. The report includes
peer tickers, per-metric sample counts, coverage, relative premiums, sources, and
retrieval times. These are selected peer medians, not whole-industry averages.
Financial reporting periods may differ, and lower multiples alone do not change
the technical BUY/SELL decision. Valuation results are cached for 15 minutes.

Yahoo requires no API key. Codex forwards `FMP_API_KEY` and `TIINGO_API_KEY`
through `env_vars`; Claude's shared MCP configuration expands those environment
variables with an empty default. An explicit key can also be supplied through
`env` in a private user/local MCP configuration. For example, set
`env.FMP_API_KEY` in that private configuration. Without a key, Yahoo remains
the data source.

Check the MCP app with `mise run typecheck:mcp` and `mise run test:mcp`.

For an interactive dashboard inside chat, ask `SPCX 대시보드를 채팅 안에 보여줘`.
The client calls `show_stock_dashboard` with the same ticker/lookback input as
`analyze_stock`. The tool links `ui://stock-checker/dashboard`, a self-contained
MCP Apps HTML resource (`text/html;profile=mcp-app`), and returns the report plus
up to 300 completed daily candles from a separate 365-day chart request.
The chart supports 1/3/6/12-month ranges, candles or a closing-price line,
volume, and pointer/keyboard OHLC inspection. The dashboard also shows the
signal, conditional execution references, historical rates with sample counts,
TTM/forward valuation, peer comparisons, and analyst targets.

The inline dashboard needs no Next.js/API server and loads no external scripts,
fonts, or network assets. Rendering requires a client with MCP Apps support;
clients without that support receive the full Markdown report and an optional
web detail link. Exposing the app resource does not prove that a particular
client renders it. Missing chart data preserves the available report.

To open a ticker's existing web detail dashboard, start the API and web servers
with `mise run dev`, then ask `SPCX 대시보드 열어줘`. The client can call:

```json
{"ticker":"SPCX"}
```

Use the `open_stock_dashboard` tool for this request. It returns the ticker URL
and opens the default browser on the computer running the local MCP server.
It checks for a web listener before opening; this check does not verify market
data or API availability. If the web server is stopped, the tool returns the
link and startup instructions. It does not start development servers.
The web detail screen shows the existing charts, signals, fundamentals and
events; the full analyst report is returned separately by `analyze_stock`.
Analyzing a ticker alone does not open a browser.

Codex forwards `STOCK_CHECKER_DASHBOARD_URL` from the environment; Claude uses
the same variable with the default URL above. Private local MCP `env` settings
can override it. Restart the MCP connection after changing its configuration.

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
- `.github/workflows/quality.yml` — lint, type checks, and offline tests for
  application and workspace changes, including the local MCP.
