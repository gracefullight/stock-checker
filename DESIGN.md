# DESIGN.md — Stock Checker Web

> Visual system source of truth for `apps/web`. Direction: **Neutral Pro** —
> standard shadcn neutral base with light/dark support, retaining finance
> semantic green/red. Built on shadcn/ui + **Base UI registry**.

## 1. Product Context

- **Product:** Bloomberg-style equity screener dashboard (technical signals,
  scores, patterns, fear & greed, per-ticker charts).
- **Audience:** Traders / active investors. Data-dense, scan-heavy reading.
- **Platform:** Web (Next.js 16 App Router, React 19). Dark-first, light supported.
- **Language:** English UI (latin-only).

## 2. Design Principles

1. **Data density first** — tables and numbers dominate; chrome stays minimal.
2. **Semantic color discipline** — green/red/amber carry meaning (buy/sell/hold,
   up/down), never decoration.
3. **Responsive-first** — works at 375px; enhance upward (768 / 1024 / 1440).
4. **WCAG AA minimum** — preserve ARIA semantics; visible focus on all interactive
   elements; respect `prefers-reduced-motion`.
5. **shadcn-first** — use shadcn/Base UI primitives; `components/ui/*` is read-only,
   customize via `cva` variants and `components/common/*` wrappers.

## 3. Typography

- **Default:** `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Tabular numerals:** monospace stack for price/indicator data —
  `ui-monospace, 'JetBrains Mono', 'Fira Code', monospace` (apply `tabular-nums`).
- Body text ≥ 16px on mobile; data cells may be smaller but keep AA contrast.

## 4. Color System (tokens)

OKLCH tokens via shadcn `:root` / `.dark`. Semantic finance tokens added on top.

| Token | Role | Maps from legacy |
|---|---|---|
| `--background` | page bg | `--bg` (#0a0a0a) |
| `--card` | panels/cards | `--surface` (#111111) |
| `--foreground` | body text | `--text-primary` (#e0e0e0) |
| `--muted-foreground` | secondary text | `--text-secondary` (#888888) |
| `--border` | borders | `--border` (#222222) |
| `--primary` | accent / links | `--cyan` (#00bcd4) |
| `--success` | BUY / up | `--green` (#00c851) |
| `--destructive` | SELL / down | `--red` (#ff4444) |
| `--warning` | HOLD / neutral | `--yellow` (#ffd700) |
| `--chart-1..5` | recharts series | (new) |

- Light + dark via the in-house `ThemeProvider` / `useTheme`
  (`components/common/theme-provider.tsx`, `.dark` class on `<html>`, dark by
  default, `localStorage` key `theme`). Charts must resolve tokens at runtime and
  react to theme change (see §7).
- Never hardcode hex in components — read tokens.

## 5. Layout & Spacing

- 8px grid. Breakpoints: 320 / 768 / 1024 / 1440 (per frontend rules).
- Cards: shadcn `Card` for panels; avoid nested-card-in-card.
- Screener table: `overflow-x` scroll on mobile (card-list view deferred).

## 6. Motion

- `transform` + `opacity` only; 150ms micro-interactions, 200–500ms transitions.
- No animation library is installed: use CSS transitions and the `tw-animate-css`
  utilities already imported in `globals.css`. Do not add `framer-motion`.
- Respect `prefers-reduced-motion` (Tailwind `motion-reduce:` variants or a media
  query) on any motion you introduce; the current UI has no reduced-motion guard.

## 7. Components

- Base: shadcn/ui on **Base UI registry** (`@base-ui/react`).
- Domain wrappers in `components/*`: `signal-badge` (cva buy/sell/hold),
  `pattern-list` (cva bullish/bearish), `score-bar` (Progress + threshold),
  `indicator-row` (TableRow). Shared chrome lives in `components/common/*`
  (`theme-provider`, `theme-toggle`, `earnings-warning-badge`).
- Charts: recharts via shadcn `ChartContainer`/`ChartConfig`
  (`indicator-gauge`, `probability-chart`); lightweight-charts kept for
  `candlestick-chart` with runtime token resolution + `useTheme`.
- All interactive elements need visible focus states.

## 8. Accessibility

- Preserve `aria-sort` (sortable table headers), `role=meter` (score bars),
  `aria-live` (loading regions), `aria-label`s.
- Keyboard navigation on all controls; semantic HTML.

## 9. Agent Prompt Guide

When generating components for this project:

- Use shadcn primitives (`Table`, `Card`, `Badge`, `Progress`, `Tooltip`,
  `Skeleton`, `Alert`) over raw `div`/generic classes. Treat `components/ui/*`
  as read-only; customize via `cva` or wrappers in `components/*`.
- Use semantic tokens (`bg-card`, `text-muted-foreground`, `text-success`,
  `text-destructive`, `text-warning`) — never raw hex.
- Numbers use `tabular-nums` + monospace stack. Body uses system sans.
- Mark interactive/hook components `'use client'`; keep layouts/static as Server
  Components.
- Preserve ARIA semantics listed in §8 on every migrated component.
- Dark/light: never hardcode chart colors — resolve from CSS tokens at runtime
  and re-render on theme change.
