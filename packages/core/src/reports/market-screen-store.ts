import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface MarketScreenLeaseOwner {
  pid: number;
  token: string;
  jobId: string;
  createdAt: string;
  purpose?: 'market-screen' | 'forward-paper-performance';
}

export function marketScreenOwnerIsAlive(owner: MarketScreenLeaseOwner): boolean {
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export async function readMarketScreenJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeMarketScreenJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readMarketScreenLease(root: string): Promise<MarketScreenLeaseOwner | null> {
  try {
    const value = await readMarketScreenJson(path.join(root, '.runner.lock', 'owner.json'));
    if (!value || typeof value !== 'object') throw new Error('Invalid lease');
    const owner = value as MarketScreenLeaseOwner;
    if (
      !Number.isInteger(owner.pid) ||
      owner.pid < 1 ||
      typeof owner.token !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(owner.token) ||
      typeof owner.jobId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(owner.jobId)
    )
      throw new Error('Invalid lease');
    if (
      owner.purpose !== undefined &&
      !['market-screen', 'forward-paper-performance'].includes(owner.purpose)
    )
      throw new Error('Invalid lease purpose');
    return owner;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('The market-screen runner lease is unreadable.');
  }
}

/** A prepared nonempty directory makes competing rename operations exclusive. */
export async function acquireMarketScreenLease(
  root: string,
  jobId: string,
  purpose: MarketScreenLeaseOwner['purpose'] = 'market-screen'
): Promise<{
  acquired: boolean;
  owner: MarketScreenLeaseOwner;
  release: () => Promise<void>;
}> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const owner: MarketScreenLeaseOwner = {
    pid: process.pid,
    token: randomUUID(),
    jobId,
    createdAt: new Date().toISOString(),
    purpose,
  };
  const prepared = path.join(root, `.runner-prepared-${owner.token}`);
  const active = path.join(root, '.runner.lock');
  await mkdir(prepared, { mode: 0o700 });
  await writeMarketScreenJson(path.join(prepared, 'owner.json'), owner);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rename(prepared, active);
        return {
          acquired: true,
          owner,
          release: async () => {
            const current = await readMarketScreenLease(root);
            if (current?.token === owner.token) await rm(active, { recursive: true, force: true });
          },
        };
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? ''))
          throw error;
        const current = await readMarketScreenLease(root);
        if (!current) continue;
        if (marketScreenOwnerIsAlive(current)) {
          return { acquired: false, owner: current, release: async () => {} };
        }
        // Keep the nonempty tombstone: another stale observer cannot rename a
        // replacement live lease over it, avoiding a stale-lock reclamation race.
        try {
          await rename(active, path.join(root, `.runner-stale-${current.token}`));
        } catch (recoveryError) {
          if (
            !['ENOENT', 'EEXIST', 'ENOTEMPTY'].includes(
              (recoveryError as NodeJS.ErrnoException).code ?? ''
            )
          )
            throw recoveryError;
        }
      }
    }
    throw new Error('The market-screen runner lease could not be acquired.');
  } finally {
    await rm(prepared, { recursive: true, force: true });
  }
}

const JOB_DIRECTORY = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Job files that stay readable after pruning: summary, BUY rows and paper ledgers. */
const RETAINED_ENTRIES = ['state.json', 'results/matches', 'performance'] as const;
const DEFAULT_STORE_ROOT = fileURLToPath(
  new URL('../../../../data/market-scans/', import.meta.url)
);

export interface PruneMarketScreenOptions {
  /** Absolute store root; defaults to the shared `data/market-scans/` store. */
  rootDirectory?: string;
  /** Jobs created at least this many days before `now` are pruned. */
  olderThanDays?: number;
  now?: () => Date;
  /** Report what would be pruned without touching the store. */
  dryRun?: boolean;
}

export interface PruneMarketScreenResult {
  rootDirectory: string;
  olderThanDays: number;
  dryRun: boolean;
  /** Jobs moved under `archive/<jobId>` with only the retained entries. */
  pruned: string[];
  /** Jobs kept because they are recent, active or unreadable. */
  kept: Array<{ id: string; reason: 'recent' | 'active' | 'unreadable' }>;
}

/**
 * Opt-in storage hygiene. Jobs older than `olderThanDays` lose their excluded and
 * unavailable rows, manifest, control and notification artifacts; the job summary,
 * BUY matches and forward paper-performance ledgers move under `archive/<jobId>`
 * where listings no longer show them. The job that holds a live runner lease is
 * never touched, and nothing in `archive/` is pruned again.
 */
export async function pruneMarketScreenJobs(
  options: PruneMarketScreenOptions = {}
): Promise<PruneMarketScreenResult> {
  const rootDirectory = path.resolve(options.rootDirectory ?? DEFAULT_STORE_ROOT);
  const olderThanDays = options.olderThanDays ?? 30;
  if (!Number.isInteger(olderThanDays) || olderThanDays < 1 || olderThanDays > 3650)
    throw new TypeError('olderThanDays must be an integer from 1 to 3650');
  const dryRun = options.dryRun === true;
  const now = (options.now ?? (() => new Date()))().getTime();
  const cutoff = now - olderThanDays * 86_400_000;
  const result: PruneMarketScreenResult = {
    rootDirectory,
    olderThanDays,
    dryRun,
    pruned: [],
    kept: [],
  };
  let entries: Dirent[];
  try {
    entries = await readdir(rootDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result;
    throw error;
  }
  const lease = await readMarketScreenLease(rootDirectory).catch(() => null);
  const activeJob = lease && marketScreenOwnerIsAlive(lease) ? lease.jobId.toLowerCase() : null;
  for (const entry of entries) {
    if (!entry.isDirectory() || !JOB_DIRECTORY.test(entry.name)) continue;
    const id = entry.name.toLowerCase();
    const directory = path.join(rootDirectory, entry.name);
    if (activeJob === id) {
      result.kept.push({ id, reason: 'active' });
      continue;
    }
    let createdAt: number;
    try {
      const state = (await readMarketScreenJson(path.join(directory, 'state.json'))) as {
        id?: unknown;
        createdAt?: unknown;
      };
      createdAt = typeof state?.createdAt === 'string' ? Date.parse(state.createdAt) : Number.NaN;
      if (state?.id !== id || !Number.isFinite(createdAt)) throw new Error('Invalid saved job');
    } catch {
      result.kept.push({ id, reason: 'unreadable' });
      continue;
    }
    if (createdAt > cutoff) {
      result.kept.push({ id, reason: 'recent' });
      continue;
    }
    result.pruned.push(id);
    if (dryRun) continue;
    const archive = path.join(rootDirectory, 'archive', id);
    await mkdir(archive, { recursive: true, mode: 0o700 });
    for (const retained of RETAINED_ENTRIES) {
      const source = path.join(directory, retained);
      const target = path.join(archive, retained);
      try {
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await rm(target, { recursive: true, force: true });
        await rename(source, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
  result.pruned.sort();
  result.kept.sort((left, right) => left.id.localeCompare(right.id));
  return result;
}
