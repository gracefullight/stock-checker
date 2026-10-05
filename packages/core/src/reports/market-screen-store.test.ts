import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  acquireMarketScreenLease,
  type MarketScreenLeaseOwner,
  marketScreenOwnerIsAlive,
  readMarketScreenJson,
  readMarketScreenLease,
  writeMarketScreenJson,
} from '@/reports/market-screen-store.ts';

const roots: string[] = [];
const children = new Set<ChildProcessWithoutNullStreams>();
const STORE_URL = new URL('./market-screen-store.ts', import.meta.url).href;

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stock-checker-store-test-'));
  roots.push(root);
  return root;
}

function exited(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', () => resolve()));
}

async function childLease(root: string) {
  const script = `
    import { acquireMarketScreenLease } from ${JSON.stringify(STORE_URL)};
    const lease = await acquireMarketScreenLease(process.argv[1], process.argv[2]);
    await new Promise((resolve) => process.stdout.write(JSON.stringify({ acquired: lease.acquired, owner: lease.owner }) + '\\n', resolve));
    if (lease.acquired) {
      process.stdin.resume();
      await new Promise((resolve) => process.stdin.once('data', resolve));
      await lease.release();
    }
    process.exit(0);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, root, randomUUID()], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.add(child);
  const result = await new Promise<{ acquired: boolean; owner: MarketScreenLeaseOwner }>(
    (resolve, reject) => {
      let output = '';
      let errors = '';
      const timer = setTimeout(() => reject(new Error('Child lease test timed out.')), 5000);
      child.stderr.on('data', (chunk) => {
        errors += String(chunk);
      });
      child.stdout.on('data', (chunk) => {
        output += String(chunk);
        if (!output.includes('\n')) return;
        clearTimeout(timer);
        try {
          resolve(JSON.parse(output.slice(0, output.indexOf('\n'))));
        } catch {
          reject(new Error('Child lease test returned invalid JSON.'));
        }
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        if (!output.includes('\n')) reject(new Error(`Child lease test failed: ${errors}`));
      });
    }
  );
  return { child, ...result };
}

afterEach(async () => {
  await Promise.all(
    [...children].map(async (child) => {
      const completion = exited(child);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await completion;
    })
  );
  children.clear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('market-screen durable store', () => {
  test('persists refresh purposes, shares exclusivity, and accepts legacy screen owners', async () => {
    const root = await temporaryRoot();
    const jobId = randomUUID();
    const refresh = await acquireMarketScreenLease(root, jobId, 'forward-paper-performance');
    expect(refresh.acquired).toBe(true);
    expect((await readMarketScreenLease(root))?.purpose).toBe('forward-paper-performance');
    expect((await acquireMarketScreenLease(root, jobId)).acquired).toBe(false);
    const { purpose: _purpose, ...legacy } = refresh.owner;
    await writeMarketScreenJson(path.join(root, '.runner.lock/owner.json'), legacy);
    expect((await readMarketScreenLease(root))?.purpose).toBeUndefined();
    expect(
      (await acquireMarketScreenLease(root, randomUUID(), 'forward-paper-performance')).acquired
    ).toBe(false);
    await refresh.release();
    expect(await readMarketScreenLease(root)).toBeNull();
  });
  test('readers observe complete old or new JSON while progress is replaced atomically', async () => {
    const root = await temporaryRoot();
    const file = path.join(root, 'nested', 'progress.json');
    const value = (version: number) => ({ version, payload: String(version).repeat(100000) });
    await writeMarketScreenJson(file, value(0));
    let finished = false;
    let observations = 0;
    const reader = (async () => {
      while (!finished) {
        const result = (await readMarketScreenJson(file)) as ReturnType<typeof value>;
        expect(Number.isInteger(result.version)).toBe(true);
        expect(result.version).toBeGreaterThanOrEqual(0);
        expect(result.version).toBeLessThanOrEqual(20);
        expect(result.payload).toBe(String(result.version).repeat(100000));
        observations++;
      }
    })();
    try {
      for (let version = 1; version <= 20; version++) {
        await writeMarketScreenJson(file, value(version));
      }
    } finally {
      finished = true;
      await reader;
    }
    expect(observations).toBeGreaterThan(0);
    expect(await readMarketScreenJson(file)).toEqual(value(20));
    expect(await readdir(path.dirname(file))).toEqual(['progress.json']);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  test('concurrent acquisition creates exactly one fully readable global owner', async () => {
    const root = await temporaryRoot();
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () => acquireMarketScreenLease(root, randomUUID()))
    );
    const winners = attempts.filter((attempt) => attempt.acquired);
    expect(winners).toHaveLength(1);
    const winner = winners[0];
    expect(await readMarketScreenLease(root)).toEqual(winner.owner);
    for (const attempt of attempts) expect(attempt.owner.token).toBe(winner.owner.token);
    expect(await readdir(root)).toEqual(['.runner.lock']);
    await winner.release();
    expect(await readMarketScreenLease(root)).toBeNull();
  });

  test('a loser or previously released token cannot release a replacement owner', async () => {
    const root = await temporaryRoot();
    const first = await acquireMarketScreenLease(root, randomUUID());
    const loser = await acquireMarketScreenLease(root, randomUUID());
    expect(loser.acquired).toBe(false);
    await loser.release();
    expect(await readMarketScreenLease(root)).toEqual(first.owner);
    await first.release();
    const replacement = await acquireMarketScreenLease(root, randomUUID());
    expect(replacement.acquired).toBe(true);
    await first.release();
    await loser.release();
    expect(await readMarketScreenLease(root)).toEqual(replacement.owner);
    await replacement.release();
    expect(await readMarketScreenLease(root)).toBeNull();
  });

  test('a second MCP process cannot reclaim an owner while its process is alive', async () => {
    const root = await temporaryRoot();
    const first = await childLease(root);
    expect(first.acquired).toBe(true);
    expect(first.owner.pid).toBe(first.child.pid);
    expect(first.owner.pid).not.toBe(process.pid);
    expect(marketScreenOwnerIsAlive(first.owner)).toBe(true);
    const second = await childLease(root);
    expect(second.child.pid).not.toBe(first.child.pid);
    expect(second.acquired).toBe(false);
    expect(second.owner).toEqual(first.owner);
    await exited(second.child);
    const localContender = await acquireMarketScreenLease(root, randomUUID());
    expect(localContender.acquired).toBe(false);
    await localContender.release();
    expect(await readMarketScreenLease(root)).toEqual(first.owner);
    const completion = exited(first.child);
    first.child.stdin.write('release\n');
    await completion;
    expect(await readMarketScreenLease(root)).toBeNull();
  });

  test('concurrent dead-owner recovery preserves the new live lease and stale tombstone', async () => {
    const root = await temporaryRoot();
    const dead = await childLease(root);
    const completion = exited(dead.child);
    dead.child.kill('SIGKILL');
    await completion;
    expect(marketScreenOwnerIsAlive(dead.owner)).toBe(false);
    for (let round = 0; round < 4; round++) {
      const roundRoot = round === 0 ? root : path.join(root, `round-${round}`);
      const stale = { ...dead.owner, token: randomUUID(), jobId: randomUUID() };
      const oldOwner = round === 0 ? dead.owner : stale;
      if (round !== 0)
        await writeMarketScreenJson(path.join(roundRoot, '.runner.lock', 'owner.json'), stale);
      const attempts = await Promise.all(
        Array.from({ length: 12 }, () => acquireMarketScreenLease(roundRoot, randomUUID()))
      );
      const winners = attempts.filter((attempt) => attempt.acquired);
      expect(winners).toHaveLength(1);
      const winner = winners[0];
      expect(await readMarketScreenLease(roundRoot)).toEqual(winner.owner);
      expect(marketScreenOwnerIsAlive(winner.owner)).toBe(true);
      expect(
        await readMarketScreenJson(
          path.join(roundRoot, `.runner-stale-${oldOwner.token}`, 'owner.json')
        )
      ).toEqual(oldOwner);
      const later = await acquireMarketScreenLease(roundRoot, randomUUID());
      expect(later.acquired).toBe(false);
      expect(later.owner).toEqual(winner.owner);
      await Promise.all(
        attempts.filter((attempt) => !attempt.acquired).map((attempt) => attempt.release())
      );
      expect(await readMarketScreenLease(roundRoot)).toEqual(winner.owner);
      await winner.release();
    }
  });

  test('an unreadable existing lease fails closed instead of starting another runner', async () => {
    const root = await temporaryRoot();
    const file = path.join(root, '.runner.lock', 'owner.json');
    await writeMarketScreenJson(file, { pid: process.pid, token: 'invalid', jobId: randomUUID() });
    await expect(acquireMarketScreenLease(root, randomUUID())).rejects.toThrow(
      'The market-screen runner lease is unreadable.'
    );
    expect(await readMarketScreenJson(file)).toMatchObject({ pid: process.pid, token: 'invalid' });
    expect(await readdir(root)).toEqual(['.runner.lock']);
  });
});
