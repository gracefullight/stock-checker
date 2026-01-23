# Suggested Commands

## Development Commands
```bash
# Install dependencies
pnpm install

# Run CLI with default tickers
pnpm start

# Run with custom tickers
pnpm start --ticker=TSLA,PLTR --sort=desc

# Run with pretty logs
pnpm start:pretty

# Run with Slack webhook
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX pnpm start --ticker=AAPL

# Or pass webhook via option
pnpm start --ticker=AAPL --slack-webhook=https://hooks.slack.com/services/XXX
```

## Project Structure Commands
```bash
# List project files
ls -la

# View src directory
ls src/

# View public outputs
ls public/
```

## Git Commands
```bash
# Check status
git status

# Add and commit changes
git add .
git commit -m "feat: description"

# View recent commits
git log --oneline

# Create and checkout new branch
git checkout -b feature/branch-name
```

## Testing (Recommended Setup)
```bash
# Install vitest (not yet installed)
pnpm add -D vitest @vitest/ui

# Run tests (once configured)
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

## Linting/Formatting (Not Yet Configured)
Consider adding:
- `eslint` with TypeScript rules
- `prettier` for code formatting
- `husky` for pre-commit hooks
