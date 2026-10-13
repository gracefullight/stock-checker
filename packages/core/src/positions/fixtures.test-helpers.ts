import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeMarketScreenJson } from '@/reports/market-screen-store';

export interface FixtureMatch {
  index: number;
  ticker: string;
  dataAsOf: string;
  decision?: 'BUY' | 'SELL' | 'HOLD';
  kind?: 'matches' | 'excluded';
  registrationStatus?: 'pending' | 'ineligible' | 'unavailable';
  validatedUniverse?: boolean;
}

export interface FixtureJob {
  id: string;
  createdAt: string;
  notification?: { status: 'accepted' | 'failed' | 'disabled' } | 'in-flight' | null;
  matches: FixtureMatch[];
  performance?: Array<{ index: number; ticker: string; status: string; netReturnPct?: number }>;
}

const roots: string[] = [];

export async function temporaryRoot(): Promise<{
  root: string;
  market: string;
  positions: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'stock-checker-positions-'));
  roots.push(root);
  return { root, market: path.join(root, 'market'), positions: path.join(root, 'positions') };
}

export async function cleanupRoots(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

/** Writes the subset of a saved market-scan job that the ledger reads. */
export async function writeFixtureJob(market: string, job: FixtureJob): Promise<void> {
  const directory = path.join(market, job.id);
  await mkdir(path.join(directory, 'results/matches'), { recursive: true });
  await mkdir(path.join(directory, 'results/excluded'), { recursive: true });
  await writeMarketScreenJson(path.join(directory, 'state.json'), {
    schemaVersion: 1,
    id: job.id,
    createdAt: job.createdAt,
    universe: { source: 'finviz-candidates' },
    criteria: { decision: 'BUY' },
    progress: { total: job.matches.length },
  });
  for (const match of job.matches) {
    const kind = match.kind ?? 'matches';
    const decision = match.decision ?? 'BUY';
    await writeMarketScreenJson(
      path.join(directory, `results/${kind}/${String(match.index).padStart(8, '0')}.json`),
      {
        index: match.index,
        kind,
        completedAt: job.createdAt,
        item: {
          ticker: match.ticker,
          dataAsOf: match.dataAsOf,
          decision,
          ...(match.validatedUniverse === undefined
            ? {}
            : { validatedUniverse: match.validatedUniverse }),
          execution: {
            entry: {
              status: 'conditional',
              timing: 'next-session-open',
              price: null,
              eligible: true,
            },
            reference: {
              basis: 'latest-completed-close',
              price: 100,
              stopLoss: 95,
              takeProfit: 110,
              atr: 3,
            },
          },
        },
        ...(decision === 'BUY' && kind === 'matches'
          ? {
              forwardPerformance: {
                schemaVersion: 1,
                recommendedAt: job.createdAt,
                dataAsOf: match.dataAsOf,
                sessions: [],
                status: match.registrationStatus ?? 'pending',
                reason: null,
              },
            }
          : {}),
      }
    );
  }
  if (job.notification !== null && job.notification !== undefined) {
    await writeMarketScreenJson(path.join(directory, 'notification.json'), {
      schemaVersion: 1,
      jobStatus: 'completed',
      attemptedAt: job.createdAt,
      finishedAt: job.notification === 'in-flight' ? null : job.createdAt,
      result:
        job.notification === 'in-flight'
          ? null
          : job.notification.status === 'accepted'
            ? { status: 'accepted', messageId: 'ABCDEF0123456789' }
            : { status: job.notification.status, reason: 'network-error' },
    });
  }
  for (const row of job.performance ?? []) {
    await writeMarketScreenJson(
      path.join(directory, `performance/${String(row.index).padStart(8, '0')}.json`),
      {
        recommendationId: `${job.id}:${row.index}`,
        ticker: row.ticker,
        status: row.status,
        netReturnPct: row.netReturnPct ?? null,
        outcome:
          row.status === 'completed'
            ? (row.netReturnPct ?? 0) > 0
              ? 'win'
              : (row.netReturnPct ?? 0) < 0
                ? 'loss'
                : 'breakeven'
            : null,
      }
    );
  }
}

export const JOB_A = 'a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1';
export const JOB_B = 'b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2';
export const JOB_C = 'c3c3c3c3-3333-4333-8333-c3c3c3c3c3c3';
export const JOB_D = 'd4d4d4d4-4444-4444-8444-d4d4d4d4d4d4';
export const JOB_E = 'e5e5e5e5-5555-4555-8555-e5e5e5e5e5e5';
