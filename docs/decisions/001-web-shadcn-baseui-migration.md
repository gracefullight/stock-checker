# 001 — Web shadcn (Base UI) Migration + axios Fetcher

**Status:** Approved (design)
**Scope:** `apps/web`
**Date:** 2026-06-09

## 1. Goal

Migrate all `apps/web` UI to shadcn/ui built on the **Base UI registry**
(`@base-ui-components/react`), swap the data fetcher to **axios**, build the
missing `/portfolio` page, and upgrade Next.js 15 → 16. Visual direction:
**Neutral Pro** — standard shadcn neutral base with light/dark toggle, retaining
finance semantic green/red.

## 2. Decisions

| Item | Decision |
|---|---|
| UI library | shadcn/ui **+ Base UI registry** (`@base-ui-components/react`) |
| Visual tone | **Neutral Pro** — shadcn neutral base, light/dark toggle, finance semantic green/red |
| Fetching | Swap `apiFetch` internals to **axios**; keep Server Component rendering structure |
| Scope | 10 components + axios + new `/portfolio` + Next 16 upgrade |
| Package manager | **bun** (`bun.lock`) |

## 3. Current State (baseline)

- Next.js 15 (App Router) + React 19, Tailwind v4. **No shadcn** (`components.json`,
  `components/ui/`, `lib/utils.ts` all absent). No `DESIGN.md`/design-tokens/i18n.
- `src/lib/api.ts` — native `fetch` wrapper `apiFetch<T>`, 8 functions (screener,
  ticker detail, fear-greed, portfolio CRUD, ohlcv). Data fetched mostly in async
  Server Components; only `FearGreedDisplay` fetches client-side.
- 10 components, all "Bloomberg terminal" look using raw-hex CSS vars
  (`--bg/--surface/--border/--green/--red/--yellow/--cyan`).
- `/portfolio` nav link exists but **page does not** (portfolio API exists).
- Charts (`candlestick`, `probability`, `indicator-gauge`) hardcode hex colors in JS.
- `params` already typed as `Promise` (Next 16 async-API compatible). No `middleware.ts`.

## 4. shadcn + Base UI Setup

- `bunx shadcn@latest init` → `components.json`: `baseColor: neutral`,
  `cssVariables: true`, Tailwind v4, `rsc: true`, alias `@/components` &
  `@/lib/utils`, `iconLibrary: lucide`.
- Install primitives from the **Base UI registry**.
  ⚠️ Verify the exact Base UI registry namespace against current shadcn docs at setup time.
- New deps: `axios`, `next-themes`, `clsx`, `tailwind-merge`, `lucide-react`.
- New files: `src/lib/utils.ts` (`cn`), `src/components/ui/*` (**read-only**),
  `src/components/common/*` (wrappers).
- shadcn components to add: `button badge card table progress skeleton alert
  tooltip separator sonner dropdown-menu chart input form`.

## 5. Design Tokens (globals.css)

Replace `:root` raw-hex vars with shadcn OKLCH tokens + `:root`/`.dark` blocks +
`@theme inline`. Add finance semantic tokens.

| Legacy var | New token | Use |
|---|---|---|
| `--bg` | `--background` | page bg |
| `--surface` | `--card` | cards/panels |
| `--border` | `--border` | borders |
| `--text-primary` | `--foreground` | body text |
| `--text-secondary` | `--muted-foreground` | secondary text |
| `--green` | `--success` (new) | BUY / up |
| `--red` | `--destructive` | SELL / down |
| `--yellow` | `--warning` (new) | HOLD / neutral |
| `--cyan` | `--primary` | accent / links |
| (new) | `--chart-1..5` | recharts series |

## 6. Component Mapping (10)

| Current | After | Location |
|---|---|---|
| `signal-badge` | shadcn `Badge` + cva `buy/sell/hold` | `common/` |
| `pattern-list` | `Badge` outline + cva bullish/bearish | `common/` |
| `score-bar` | Base UI `Progress` wrapper + threshold colors, keep `role=meter` | `common/` |
| `indicator-row` | shadcn `TableRow`/`TableCell` | `common/` |
| `screener-table` | shadcn `Table` (keep sort logic, client) + Badge/Progress wrappers | `features/screener/` |
| `fear-greed-display` | `Badge` + `Tooltip`, keep client | `common/` |
| `indicator-gauge` | recharts `RadialBar` → shadcn `ChartContainer` + `ChartConfig` | `features/ticker/` |
| `probability-chart` | recharts `Pie` → `ChartContainer` + `ChartTooltipContent` | `features/ticker/` |
| `candlestick-chart` | keep lightweight-charts + runtime token resolution + `useTheme` reactivity, wrap in `Card`/`Skeleton` | `features/ticker/` |
| `ticker-charts` | `Card` composition, keep dynamic import | `features/ticker/` |

**App shell:** add `ThemeProvider` (next-themes) + header theme toggle (`Button`
sun/moon) + `Sonner` Toaster in `layout.tsx`; nav as `Button variant=ghost`. The
`Section` helper in `[ticker]/page.tsx` → `Card`/`CardHeader`/`CardContent`. Page
loading/error → `Skeleton`/`Alert`.

## 7. axios Fetcher

```ts
const http = axios.create({
  baseURL: API_URL,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});
// response interceptor normalizes errors to: Error(`API error ${status}: ${statusText}`)
// apiFetch -> http.request<T>({ url: path, ...init }).then(r => r.data)
```

- All 8 function signatures **unchanged** → zero call-site changes. Works in
  Server and Client Components.
- ⚠️ Tradeoff: Server Components lose Next `fetch` cache/dedupe (accepted per the
  tactical fetch-swap decision).
- Prefer a server-only `API_URL` (non-public) branch to avoid exposing the
  internal address during SSR; fall back to `NEXT_PUBLIC_API_URL` when unset.

## 8. /portfolio Page (new)

- `src/app/portfolio/page.tsx` (server): `getPortfolio()` → tickers →
  `getScreener(tickers)` → reuse `ScreenerTable`.
- Add/remove: a client component calls `addToPortfolio`/`removeFromPortfolio`,
  then `router.refresh()`, with `sonner` toast feedback (no TanStack Query — per
  decision). Includes empty state and an add form (`Input` + `Button`).

## 9. Next 16 Upgrade

- `apps/web/package.json`: `next` `^15` → `^16` (keep react 19).
- `params` already `Promise` → async-API compatible.
- **No `middleware.ts` → no migration. No request gate/auth → `proxy.ts` not
  needed** (add only when a request gate is later required). Never create or
  restore `middleware.ts`.
- Review `next.config.ts` compatibility (keep `transpilePackages`); keep dev `--turbo`.

## 10. Blind Review Resolutions

**Tier 1 (resolved before save):**
1. Chart hardcoded hex breaks in light theme → runtime CSS token resolution +
   `useTheme` re-render (§6).
2. axios global error normalization preserves the existing error-message contract (§7).
3. `NEXT_PUBLIC_API_URL` exposes internal address in SSR → server-only `API_URL`
   branch with fallback (§7).
4. Preserve all ARIA semantics (`aria-sort`, `role=meter`, `aria-live`) as a hard
   migration requirement (§6).

**Tier 2 (deferred / explicit):**
5. Mobile screener keeps `overflow-x`; card list (<640px) deferred to next enhancement.
6. FSD-lite `features/*` relocation recommended; phase 1 introduces `ui/`+`common/`,
   feature-folder moves optional within the same PR.
7. Post-upgrade `typecheck` + `build` smoke required in CI.

**Tier 3 (next):**
8. Persist token map in `DESIGN.md` (done). Component Storybook later.

## 11. Next Step

Run `/plan` to decompose this into actionable tasks.
