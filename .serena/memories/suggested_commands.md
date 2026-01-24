# Suggested Commands

## Development
- **Run the project**:
  ```bash
  bun start --ticker=TSLA,AAPL --sort=desc
  ```
- **Run with specific options**:
  ```bash
  bun start --ticker=GOOGL --slack-webhook=https://...
  ```

## Testing & Quality
- **Run tests**:
  ```bash
  bun test
  ```
- **Watch tests**:
  ```bash
  bun test:watch
  ```
- **Lint code**:
  ```bash
  bun lint
  ```
- **Format code**:
  ```bash
  bun format
  ```
- **Check code (Lint + Format)**:
  ```bash
  bun check
  ```

## Helper Scripts
- **Optimize**: `bun run optimize`
- **Learn**: `bun run learn` (from scripts/learn.ts)
