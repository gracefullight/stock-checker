import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface MarketScreenLeaseOwner {
  pid: number;
  token: string;
  jobId: string;
  createdAt: string;
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
    return owner;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('The market-screen runner lease is unreadable.');
  }
}

/** A prepared nonempty directory makes competing rename operations exclusive. */
export async function acquireMarketScreenLease(
  root: string,
  jobId: string
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
