import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard: the browser entry (src/browser.ts) must stay free of I/O modules —
 * pino, yahoo-finance2, axios, node:fs, DataLoader — across its whole static
 * import graph, or the Web Worker bundle breaks.
 */
const SRC = path.resolve(__dirname, '..');
const BANNED = [
  'pino',
  'yahoo-finance2',
  'axios',
  'node:fs',
  "'fs'",
  'node:child_process',
  'data-loader',
  'data-fetcher',
];

function resolveImport(spec: string, fromFile: string): string | null {
  let rel: string;
  if (spec.startsWith('@/')) rel = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) rel = path.resolve(path.dirname(fromFile), spec);
  else return null; // bare package import — checked against BANNED directly
  for (const candidate of [`${rel}.ts`, path.join(rel, 'index.ts')]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

function collectGraph(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const text = readFileSync(entry, 'utf-8');
  // Statement-wise scan (imports span multiple lines). Runtime imports only:
  // `import type` / `export type` statements are erased by the bundler.
  const statements = text.split(';');
  const specs: string[] = [];
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (!/^(?:import|export)\b/.test(trimmed)) continue;
    if (/^(?:import|export)\s+type\b/.test(trimmed)) continue;
    const m = trimmed.match(/from\s+['"]([^'"]+)['"]\s*$/);
    if (m) specs.push(m[1]);
  }
  for (const spec of specs) {
    for (const banned of BANNED) {
      expect(spec.includes(banned.replaceAll("'", '')), `${entry} imports banned "${spec}"`).toBe(
        false
      );
    }
    const resolved = resolveImport(spec, entry);
    if (resolved) collectGraph(resolved, seen);
  }
  return seen;
}

describe('browser entry purity', () => {
  it('has no I/O modules in the static import graph of src/browser.ts', () => {
    const graph = collectGraph(path.join(SRC, 'browser.ts'));
    expect(graph.size).toBeGreaterThan(5);
    for (const file of graph) {
      const code = readFileSync(file, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      for (const banned of ["'pino'", "'yahoo-finance2'", "'axios'", "'node:fs'"]) {
        expect(code.includes(banned), `${file} references banned ${banned}`).toBe(false);
      }
    }
  });
});
