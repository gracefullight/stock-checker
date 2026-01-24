# Code Style and Conventions

## Language & Runtime
- **Language**: TypeScript (Target: ESNext)
- **Runtime**: Bun / Node.js 24

## Formatting & Linting
- **Tool**: Biome
- **Configuration**: `biome.json`
- **Rules**:
  - Enforce consistent casing.
  - Strict type checking enabled (`"strict": true` in `tsconfig.json`).
  - No emit (using Bun/ts-node for execution).

## Import Conventions
- Use absolute imports with `@/` alias pointing to `src/`.
  - Example: `import { ... } from "@/services/..."`
- `moduleResolution` is set to `bundler`.
- `allowImportingTsExtensions` is true (so `.ts` extensions in imports might be allowed/expected depending on context, though `bun` handles them well).

## Project Structure
- Group tests in `__tests__` directories near their source or centered in `src/__tests__` (aiming for `__tests__` directories).
- Use `src/types` for shared type definitions.
- Use `src/constants.ts` for global constants.
