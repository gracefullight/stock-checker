# Repository Guidelines

## Project Structure & Module Organization
- `src/index.ts`: CLI entry; fetches quotes, computes indicators, writes CSV, optional Slack alerts.
- `public/`: Dated CSV outputs (e.g., `stock_data_20250824.csv`).
- `.github/workflows/daily-data.yml`: Nightly scheduler that runs the CLI and commits new CSVs.
- `tsconfig.json`: TypeScript config (strict mode, ESNext target, CommonJS).

## Build, Test, and Development Commands
- `bun install`: Install dependencies (Bun `1` required).
- `bun start --ticker=TSLA,PLTR --sort=asc`: Run locally via `bun` (no build step). Writes/updates `public/stock_data_YYYYMMDD.csv`.
- `bun start:pretty`: Same as above, pretty log output via `pino-pretty`.
- Slack alerts: `SLACK_WEBHOOK_URL=... bun start --ticker=AAPL --sort=desc` or `--slack-webhook=...`.

## Coding Style & Naming Conventions
- Language: TypeScript with `strict: true`, `esModuleInterop: true`.
- Modules: CommonJS (`module: "CommonJS"`).
- Indentation: 2 spaces; keep lines focused and typed.
- Naming: `lowerCamelCase` for vars/functions, `UpperCamelCase` for types/interfaces, `UPPER_SNAKE_CASE` for constants.
- Logging: Use `pino` (avoid `console.log`).
- Structure: Keep the CLI thin; factor helpers into small functions within `src/` as needed.

## Testing Guidelines
- Current status: No formal test suite. Contributions adding tests are welcome.
- Recommendation: `vitest` with `*.test.ts` colocated under `src/` or in `tests/`.
- Scope: Cover indicator computations, opinion scoring, CSV row formatting, and Slack payload formatting.

## Commit & Pull Request Guidelines
- Commits: Follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`). Examples in history: `feat: add INTC and UPST tickers`, `fix: notify slack after csv write`.
- PRs: Include a concise description, linked issue (if any), and a sample run (command used plus snippet of CSV output or logs). Note any changes affecting the GH Action.
- CI: Ensure the nightly workflow continues to succeed without extra setup (no new required secrets).

## Security & Configuration Tips
- Do not commit secrets. Pass Slack webhooks via env vars or GitHub Secrets.
- Network calls: Uses public Yahoo Finance API and alternative.me FGI; handle failures gracefully (already logged) and avoid adding rate-limited loops.
