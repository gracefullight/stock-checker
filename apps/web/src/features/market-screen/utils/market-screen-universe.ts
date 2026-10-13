import type { MarketScreenJob } from '@/lib/api';
import { usSessionDate } from '@/lib/us-session-date';

/** Paused jobs untouched for this long are hidden when the toggle is on. */
export const STALE_PAUSED_JOB_MS = 48 * 60 * 60 * 1000;

/** Source lane of a saved job: Finviz candidates sit outside the validated universe. */
export function isValidatedUniverseJob(job: Pick<MarketScreenJob, 'universe'>): boolean {
  return job.universe.source !== 'finviz-candidates';
}

/** Lane label shown on job cards and the source card. */
export function universeLabel(job: Pick<MarketScreenJob, 'universe'>): string {
  return isValidatedUniverseJob(job)
    ? `검증 유니버스${job.universe.label ? ` · ${job.universe.label}` : ''}`
    : '검증 유니버스 외 · Finviz 후보';
}

export function isStalePausedJob(
  job: Pick<MarketScreenJob, 'status' | 'updatedAt'>,
  now: number
): boolean {
  if (job.status !== 'paused') return false;
  const updated = Date.parse(job.updatedAt);
  return Number.isFinite(updated) && now - updated > STALE_PAUSED_JOB_MS;
}

/** Session the job describes: server-recorded when present, else the US date of creation. */
export function jobSessionDate(
  job: Pick<MarketScreenJob, 'createdAt'> & { sessionDate?: string | null }
): string | null {
  return job.sessionDate ?? usSessionDate(job.createdAt);
}

/** Human origin for a job card: label/origin when recorded, else the manual lane. */
export function jobOrigin(job: Pick<MarketScreenJob, 'label' | 'origin'>): string {
  const parts = [job.label, job.origin].filter((part): part is string => !!part);
  return parts.length ? parts.join(' · ') : 'MCP / manual';
}
