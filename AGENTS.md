# Repository Guidelines

## Project Structure & Module Organization
- `packages/core/src/`: Signal engine, backtest, persistence, and CLI entry (`index.ts`).
- `packages/core/public/`: Monthly CSV outputs (e.g., `stock_data_202610.csv`).
- `apps/api/src/`: Fastify API for stock analysis, history, portfolio, and watchlist.
- `apps/web/src/`: Next.js screener, charts, portfolio, and alerts.
- `.github/workflows/daily-data.yml`: Nightly scheduler that runs the CLI and commits new CSVs.
- `mise.toml`: Runtime versions and development, quality, and CLI tasks.
- `tools/finance/`: Locked Python finance dependencies, Pyrefly settings, and pytest regressions.
- `tsconfig.json`: Shared TypeScript config (strict mode, ESNext modules, bundler resolution).

## Build, Test, and Development Commands
- `mise install`: Install Node 26, Bun 1.4.2, Python 3.14, and uv 0.12.22.
- `bun install`: Install workspace dependencies and repository Git hooks.
- `mise run dev`: Start the API (5101) and web (5100) servers.
- `mise run predict -- --ticker=TSLA,PLTR --sort=asc`: Run predictions and append monthly CSV rows.
- `mise run lint`, `mise run typecheck`, `mise run test`: Run quality checks.
- `mise run finance:typecheck`: Check the Python financial scripts with Pyrefly.
- `mise run finance:lint`, `mise run finance:format:check`: Check Python lint and formatting with Ruff.
- `mise run finance:fix`: Apply safe Ruff fixes, then format sequentially.
- `mise run finance:test`: Run the offline Python finance regressions.
- `mise run mcp`: Run the local stock analyst MCP over stdio; reserve stdout for JSON-RPC.
- `mise run typecheck:mcp`, `mise run test:mcp`: Check the MCP integration.
- Slack alerts: `SLACK_WEBHOOK_URL=... mise run predict -- --ticker=AAPL` or `--slack-webhook=...`.

## Coding Style & Naming Conventions
- Language: TypeScript with `strict: true`, `esModuleInterop: true`.
- Modules: ESNext with bundler resolution.
- Indentation: 2 spaces; keep lines focused and typed.
- Naming: `lowerCamelCase` for vars/functions, `UpperCamelCase` for types/interfaces, `UPPER_SNAKE_CASE` for constants.
- Logging: Use `pino` (avoid `console.log`).
- Structure: Keep CLI and route handlers thin; place helpers in the owning workspace's `src/`.

## Testing Guidelines
- Vitest suites are colocated as `*.test.ts` / `*.test.tsx` in each workspace's `src/`.
- Python finance regressions use pytest under `tools/finance/tests/`.
- Use `mise run test:core`, `mise run test:api`, or `mise run test:web` for scoped checks.
- Add regression tests for behavior changes; use fixtures and mocks for external market data.

## Commit & Pull Request Guidelines
- Commits: Follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`). Examples in history: `feat: add INTC and UPST tickers`, `fix: notify slack after csv write`.
- PRs: Include a concise description, linked issue (if any), and a sample run (command used plus snippet of CSV output or logs). Note any changes affecting the GH Action.
- CI: Ensure the nightly workflow continues to succeed without extra setup (no new required secrets).

## Security & Configuration Tips
- Do not commit secrets. Pass Slack webhooks via env vars or GitHub Secrets.
- Network calls: Uses public Yahoo Finance API and alternative.me FGI; handle failures gracefully (already logged) and avoid adding rate-limited loops.

<!-- OMA:START — managed by oh-my-agent. Do not edit this block manually. -->

# oh-my-agent

Follow `.agents/skills/_shared/core/execution-policy.md` for authorization, clarification, verification, and completion. System/developer instructions and the user's request take precedence over OMA defaults. Never build, compile, bundle, or package software unless the user explicitly requests a build.

- **SSOT**: Do not modify `.agents/` definitions (skills, workflows, rules, agents, config) directly. Run outputs under `.agents/results/` and `.agents/state/` are generated artifacts and may be written.
- **Response language**: Follow `language` in `.agents/oma-config.yaml`.
- **Skills**: Read the relevant `.agents/skills/{name}/SKILL.md` when needed.
- **Subagents**:
  - claude: Same-vendor native dispatch via Claude Code Agent tool with `.claude/agents/{name}.md`; cross-vendor fallback via `oma agent spawn`
  - codex: Same-vendor native dispatch via Codex custom agents in `.codex/agents/{name}.toml`; cross-vendor fallback via `oma agent spawn`
  - cursor: `@agent-name` (defined in `.cursor/agents/`)
  - qwen: Same-vendor native dispatch via Qwen Code subagents in `.qwen/agents/{name}.md`; cross-vendor fallback via `oma agent spawn`
- Write non-ASCII tool-call parameters as literal UTF-8, not Unicode escapes.

## Per-Agent Dispatch

Resolve each agent from `.agents/oma-config.cue` or `.agents/oma-config.yaml`, overlaid by `.agents/oma-config.local.cue` or `.agents/oma-config.local.yaml` when present. With `model_preset: free`, always use `oma agent spawn` so the subprocess receives the FreeLLMAPI route; `free.model` replaces per-agent model pins. Otherwise, explicit `agents:` overrides take priority. With `model_preset: auto`, follow the current vendor's native agent/model settings; use `default_cli` only when the runtime is unknown. Use native subagents when the target matches the current runtime; otherwise, or when native dispatch is unavailable, use `oma agent spawn`.

## Code Search

Serena MCP is required for code search and discovery. Load deferred tools before use. Use `find_file` for paths, `search_for_pattern` for content, and `find_symbol` / `get_symbols_overview` for symbols. Native search is only for paths outside this project, ignored paths, or plain non-code content. The PreToolUse guard already allows searches confined to confirmed provider exclusions or paths outside this project.

## Workflows

Run workflows only when explicitly requested or detected by a hook; never self-initiate. Read and follow `.agents/workflows/{name}.md`. Continue active workflows until complete or explicitly cancelled.

## Project Rules

Read the relevant file from `.agents/rules/` when working on matching code.

| Rule | File | Scope |
|------|------|-------|
| backend | `.agents/rules/backend.md` | on request |
| commit | `.agents/rules/commit.md` | on request |
| database | `.agents/rules/database.md` | **/*.{sql,prisma} |
| debug | `.agents/rules/debug.md` | on request |
| design | `.agents/rules/design.md` | on request |
| dev-workflow | `.agents/rules/dev-workflow.md` | on request |
| frontend | `.agents/rules/frontend.md` | **/*.{tsx,jsx,css,scss} |
| i18n-arb | `.agents/rules/i18n-arb.md` | **/*.arb |
| i18n-guide | `.agents/rules/i18n-guide.md` | always |
| infrastructure | `.agents/rules/infrastructure.md` | **/*.{tf,tfvars,hcl} |
| market | `.agents/rules/market.md` | on request |
| mobile | `.agents/rules/mobile.md` | **/*.{dart,swift,kt} |
| quality | `.agents/rules/quality.md` | on request |

<!-- OMA:END -->
