# Task Completion Checklist

Before considering a task complete:

1. **Linting & Formatting**:
   - Run `bun check` to ensure no linting errors and correct formatting.
   - Run `bun format` if needed.

2. **Testing**:
   - Run `bun test` to ensure all tests pass.
   - Add new tests if new functionality was introduced.

3. **Build/Run Verification**:
   - Verify the project runs:
     ```bash
     bun start --ticker=AAPL
     ```
   - Check if outputs (CSVs) are generated correctly in `public/`.

4. **Code Quality**:
   - Ensure imports use `@/` alias.
   - Ensure explicit return types for public functions.
   - Remove unused imports and variables.
