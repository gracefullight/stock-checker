import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  marketRootDirectory,
  type PositionEntry,
  type PositionLedgerDependencies,
  readPositionLedger,
  syncPositionsFromMarketScans,
} from '@/positions/ledger';
import {
  type PositionSizing,
  type PositionTiming,
  positionTiming,
  resolvePositionSizing,
  VALIDATED_EXPECTATION,
} from '@/positions/plan';
import { readMarketScreenJson } from '@/reports/market-screen-store';
import { formatPositionDigest } from '@/utils/position-alerts';
import type { WhatsAppNotification } from '@/utils/whatsapp';

export interface PositionPaperResult {
  status: string;
  netReturnPct: number | null;
  outcome: 'win' | 'loss' | 'breakeven' | null;
}

export interface PositionDigestItem {
  entry: PositionEntry;
  timing: PositionTiming;
  kind: 'entry' | 'exit-eve' | 'holding' | 'exit-passed' | 'closed';
  /** Forward paper outcome from the saved performance ledger, when the daily report tracked it. */
  paper: PositionPaperResult | null;
  /** Realised return from the recorded fill and close; null until both exist. */
  actualReturnPct: number | null;
  /** The current scan produced a SELL decision for this held ticker (outside the validated rule). */
  sellSignal: boolean;
}

export interface PositionDigest {
  generatedAt: string;
  nextOpenSession: string | null;
  latestCompletedSession: string | null;
  items: PositionDigestItem[];
  /** Rows kept out of the plan, with the user-facing reason. */
  excluded: Array<{ ticker: string; signalSession: string; reason: string }>;
  sizing: PositionSizing;
  expectation: typeof VALIDATED_EXPECTATION;
  warnings: string[];
}

export interface PositionDigestOptions extends Omit<PositionLedgerDependencies, 'now'> {
  now: Date;
  /** The job being sent right now; its BUYs arrive through the report itself, not the ledger. */
  currentJobId?: string | null;
  /** Skip ingesting newly notified BUYs (read-only views). */
  sync?: boolean;
}

const MAX_SUMMARY_LENGTH = 3000;
const MIN_DIGEST_RESERVE = 420;
const CLOSED_VISIBLE_MS = 3 * 86_400_000;
const MAX_SELL_SCAN_FILES = 5000;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

async function paperResult(
  market: string,
  entry: PositionEntry
): Promise<PositionPaperResult | null> {
  if (entry.source.kind !== 'daily-report') return null;
  try {
    const row = (await readMarketScreenJson(
      path.join(
        market,
        entry.source.jobId,
        'performance',
        `${String(entry.source.recommendationIndex).padStart(8, '0')}.json`
      )
    )) as { ticker?: string; status?: string; netReturnPct?: unknown; outcome?: unknown };
    if (row?.ticker !== entry.ticker || typeof row.status !== 'string') return null;
    const completed =
      row.status === 'completed' &&
      typeof row.netReturnPct === 'number' &&
      Number.isFinite(row.netReturnPct) &&
      ['win', 'loss', 'breakeven'].includes(row.outcome as string);
    return {
      status: row.status,
      netReturnPct: completed ? (row.netReturnPct as number) : null,
      outcome: completed ? (row.outcome as PositionPaperResult['outcome']) : null,
    };
  } catch (error) {
    if (missing(error)) return null;
    return { status: 'unreadable', netReturnPct: null, outcome: null };
  }
}

/** Tickers the current scan decided SELL, read from its saved results only. */
async function sellSignals(market: string, jobId: string | null | undefined): Promise<Set<string>> {
  const tickers = new Set<string>();
  if (!jobId || !/^[a-f0-9-]{36}$/i.test(jobId)) return tickers;
  let scanned = 0;
  for (const kind of ['matches', 'excluded']) {
    const directory = path.join(market, jobId.toLowerCase(), 'results', kind);
    let names: string[];
    try {
      names = (await readdir(directory)).filter((name) => /^\d{8}\.json$/.test(name));
    } catch {
      continue;
    }
    for (const name of names) {
      if (++scanned > MAX_SELL_SCAN_FILES) return tickers;
      try {
        const saved = (await readMarketScreenJson(path.join(directory, name))) as {
          item?: { ticker?: string; decision?: string };
        };
        if (saved?.item?.decision === 'SELL' && typeof saved.item.ticker === 'string')
          tickers.add(saved.item.ticker);
      } catch {
        /* Unreadable rows never block the digest. */
      }
    }
  }
  return tickers;
}

export async function buildPositionDigest(options: PositionDigestOptions): Promise<PositionDigest> {
  const environment = options.environment ?? process.env;
  const dependencies: PositionLedgerDependencies = { ...options, now: () => options.now };
  const market = marketRootDirectory(dependencies);
  const warnings: string[] = [];
  if (options.sync !== false) {
    try {
      await syncPositionsFromMarketScans(dependencies, { excludeJobId: options.currentJobId });
    } catch {
      warnings.push('새 BUY 발송 기록을 장부에 반영하지 못했습니다. 기존 장부만 표시합니다.');
    }
  }
  const ledger = await readPositionLedger(dependencies);
  if (ledger.unreadable > 0)
    warnings.push(`읽을 수 없는 장부 파일 ${ledger.unreadable}개를 건너뛰었습니다.`);
  const sells = await sellSignals(market, options.currentJobId);
  const instant = options.now.getTime();
  const items: PositionDigestItem[] = [];
  const excluded: PositionDigest['excluded'] = [];
  let nextOpenSession: string | null = null;
  let latest: string | null = null;
  for (const entry of ledger.entries) {
    const timing = positionTiming(entry.plan, options.now);
    nextOpenSession ??= timing.nextOpenSession;
    latest ??= timing.latestCompletedSession;
    if (entry.close) {
      if (instant - Date.parse(entry.close.recordedAt) > CLOSED_VISIBLE_MS) continue;
      items.push({
        entry,
        timing,
        kind: 'closed',
        paper: await paperResult(market, entry),
        actualReturnPct: entry.fill ? (entry.close.price / entry.fill.price - 1) * 100 : null,
        sellSignal: false,
      });
      continue;
    }
    if (!entry.inPlan) {
      excluded.push({
        ticker: entry.ticker,
        signalSession: entry.signalSession,
        reason:
          entry.plan.reason ??
          (entry.validatedUniverse
            ? '계획 제외'
            : '검증 범위 밖 종목 (POSITIONS_INCLUDE_UNVALIDATED=1로 포함)'),
      });
      continue;
    }
    if (timing.stage === 'unplanned' || timing.stage === 'scheduled') continue;
    const kind = timing.stage;
    items.push({
      entry,
      timing,
      kind,
      paper: kind === 'exit-passed' ? await paperResult(market, entry) : null,
      actualReturnPct: null,
      sellSignal: sells.has(entry.ticker),
    });
  }
  const order: Record<PositionDigestItem['kind'], number> = {
    'exit-eve': 0,
    'exit-passed': 1,
    entry: 2,
    holding: 3,
    closed: 4,
  };
  items.sort(
    (left, right) =>
      order[left.kind] - order[right.kind] ||
      left.entry.signalSession.localeCompare(right.entry.signalSession) ||
      left.entry.ticker.localeCompare(right.entry.ticker)
  );
  const sizing = resolvePositionSizing(environment);
  for (const name of sizing.invalid) warnings.push(`${name} 값이 올바르지 않아 무시했습니다.`);
  return {
    generatedAt: options.now.toISOString(),
    nextOpenSession,
    latestCompletedSession: latest,
    items,
    excluded,
    sizing,
    expectation: VALIDATED_EXPECTATION,
    warnings,
  };
}

/** True when the digest carries an action the user must not miss tonight. */
export function digestHasReminders(digest: PositionDigest): boolean {
  return digest.items.some((item) => item.kind !== 'holding' && item.kind !== 'closed');
}

function trimSummary(summary: string, maximum: number): string {
  if (summary.length <= maximum) return summary;
  const omission = '\n\n일부 상세는 길이 제한으로 생략.';
  const limit = Math.max(0, maximum - omission.length);
  const cut = summary.lastIndexOf('\n\n', limit);
  return `${summary.slice(0, cut > 0 ? cut : limit).trimEnd()}${omission}`;
}

/**
 * Appends the '보유 계획' section to a morning notification, inside the 3,000-unit
 * WhatsApp budget. Reminders outrank the tail of the screening text; a digest with
 * nothing to show leaves the notification untouched.
 */
export async function appendPositionDigest(
  notification: WhatsAppNotification,
  options: PositionDigestOptions
): Promise<WhatsAppNotification> {
  const digest = await buildPositionDigest(options);
  let summary = notification.summary;
  let text = formatPositionDigest(digest, MAX_SUMMARY_LENGTH - summary.length - 2);
  if (!text && digestHasReminders(digest)) {
    summary = trimSummary(summary, MAX_SUMMARY_LENGTH - MIN_DIGEST_RESERVE - 2);
    text = formatPositionDigest(digest, MAX_SUMMARY_LENGTH - summary.length - 2);
  }
  if (!text) return notification;
  return { ...notification, summary: summary ? `${summary}\n\n${text}` : text };
}
