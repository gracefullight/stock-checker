# Code Style and Conventions

## TypeScript Configuration
- **Module System**: CommonJS (`module: "CommonJS"`)
- **Target**: ESNext
- **Strict Mode**: Enabled (`strict: true`)
- **esModuleInterop**: Enabled

## Naming Conventions
- **Variables/Functions**: `lowerCamelCase` (e.g., `getHistoricalPrices`, `processTicker`)
- **Types/Interfaces**: `UpperCamelCase` (e.g., `CliOptions`, `TickerResult`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `CSV_DIR`, `INDICATOR_WEIGHTS`)
- **File Names**: `lowerCamelCase.ts` (e.g., `index.ts`)

## Code Organization
- **CLI Entry**: All logic in `src/index.ts`
- **Constants**: Defined at top of file (weights, thresholds, settings)
- **Helper Functions**: Grouped by purpose (data fetch, pattern detection, CSV writer)
- **Interface Definitions**: After constants, before implementations
- **Main Logic**: At bottom, wrapped in `if (require.main === module)`

## Logging
- **Library**: `pino` (structured logging)
- **No `console.log`**: Use `logger.info()`, `logger.warn()`, `logger.error()`
- **Transport**: `pino-pretty` for human-readable output in development

## Indentation & Formatting
- **Spaces**: 2 spaces
- **Keep lines focused**: Break long lines for readability
- **Type annotations**: Explicitly typed (no implicit `any`)

## Code Style Preferences
- **Functional over Object-Oriented**: Prefer pure functions
- **Small functions**: Factor helpers within `src/` as needed
- **Keep CLI thin**: Delegation to helper functions

## Git & Commits
- **Format**: Conventional Commits
  - `feat:` - New features
  - `fix:` - Bug fixes
  - `docs:` - Documentation
  - `chore:` - Maintenance tasks
- **Examples from history**:
  - `feat: add INTC and UPST tickers`
  - `fix: notify slack after csv write`

## Security
- **No secrets in repo**: Pass via env vars or GitHub Secrets
- **Network calls**: Handle failures gracefully, avoid rate-limited loops
