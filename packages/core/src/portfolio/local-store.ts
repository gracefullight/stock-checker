import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repository-anchored store for small JSON files shared by the CLI, API and web.
 * The location is module-relative, so every entry point reads the same file
 * regardless of its working directory.
 */
export const LOCAL_STORE_ROOT = fileURLToPath(new URL('../../../../data/', import.meta.url));

export function localStorePath(fileName: string): string {
  return path.join(LOCAL_STORE_ROOT, fileName);
}

/**
 * Previous working-directory locations, newest writer first: the API ran from
 * apps/api, the CLI from packages/core, and ad-hoc runs from the current directory.
 */
export function legacyStorePaths(fileName: string): string[] {
  const candidates = [
    fileURLToPath(new URL(`../../../../apps/api/${fileName}`, import.meta.url)),
    fileURLToPath(new URL(`../../${fileName}`, import.meta.url)),
    path.resolve(process.cwd(), fileName),
  ];
  return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Returns the parsed file, or null only when the file does not exist. */
export async function readJsonStore<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function writeJsonStore(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf-8');
}

export interface LegacyMigration<T> {
  /** Legacy files that were merged into the new store, in merge order. */
  sources: string[];
  value: T | null;
}

/**
 * One-time merge of legacy working-directory files. Legacy files are left in
 * place; the merged result is written to the anchored store only when it does
 * not exist yet, so later edits are never overwritten by stale copies.
 */
export async function migrateLegacyStores<T>(
  target: string,
  legacyFileName: string,
  merge: (values: T[]) => T
): Promise<LegacyMigration<T>> {
  const sources: string[] = [];
  const values: T[] = [];
  for (const file of legacyStorePaths(legacyFileName)) {
    const value = await readJsonStore<T>(file);
    if (value === null) continue;
    sources.push(file);
    values.push(value);
  }
  if (values.length === 0) return { sources, value: null };
  const merged = merge(values);
  await writeJsonStore(target, merged);
  return { sources, value: merged };
}
