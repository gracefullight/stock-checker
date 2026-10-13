import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pino from 'pino';
import { buildPositionDigest } from '@/positions/digest';
import {
  closePosition,
  type PositionEntry,
  type PositionLedgerDependencies,
  readPositionLedger,
  recordPositionFill,
  syncPositionsFromMarketScans,
} from '@/positions/ledger';
import { positionTiming } from '@/positions/plan';
import {
  formatPercent,
  formatPositionDigest,
  formatSessionLabel,
  formatSydneyTime,
} from '@/utils/position-alerts';

const logger = pino({ name: 'positions' }, process.stderr);
const COMMANDS = ['list', 'digest', 'sync', 'record-fill', 'close'] as const;
const OPTIONS = ['ticker', 'session', 'price', 'size', 'note'] as const;

export type PositionsCommand = (typeof COMMANDS)[number];

export interface PositionsArguments {
  command: PositionsCommand;
  json: boolean;
  ticker?: string;
  session?: string;
  price?: number;
  size?: number;
  note?: string;
}

export function parsePositionsArguments(arguments_: string[]): PositionsArguments {
  const [command, ...rest] = arguments_;
  if (!COMMANDS.includes(command as PositionsCommand))
    throw new TypeError(`Use one of: ${COMMANDS.join(', ')}`);
  const parsed: PositionsArguments = { command: command as PositionsCommand, json: false };
  const seen = new Set<string>();
  for (const argument of rest) {
    if (argument === '--json') {
      parsed.json = true;
      continue;
    }
    const match = /^--(ticker|session|price|size|note)=(.+)$/s.exec(argument);
    if (!match || seen.has(match[1]))
      throw new TypeError(
        `Use unique --ticker=, --session=, --price=, --size=, --note= options or --json`
      );
    seen.add(match[1]);
    const name = match[1] as (typeof OPTIONS)[number];
    if (name === 'price' || name === 'size') {
      const value = Number(match[2]);
      if (!Number.isFinite(value) || value <= 0)
        throw new TypeError(`--${name} must be a positive number`);
      parsed[name] = value;
    } else parsed[name] = match[2];
  }
  const required: Partial<Record<PositionsCommand, Array<(typeof OPTIONS)[number]>>> = {
    'record-fill': ['ticker', 'session', 'price', 'size'],
    close: ['ticker', 'session', 'price'],
  };
  for (const name of required[parsed.command] ?? []) {
    if (parsed[name] === undefined) throw new TypeError(`${parsed.command} requires --${name}=`);
  }
  if (!required[parsed.command] && seen.size > 0)
    throw new TypeError(`${parsed.command} accepts only --json`);
  return parsed;
}

function describe(entry: PositionEntry, now: Date): string {
  const timing = positionTiming(entry.plan, now);
  const stage = entry.close
    ? `청산 완료 ${entry.close.price.toFixed(2)}`
    : !entry.inPlan
      ? `계획 제외 · ${entry.plan.reason ?? '검증 범위 밖'}`
      : {
          scheduled: '진입 대기',
          entry: '진입 예정',
          holding: `보유 중 ${timing.dayCount}/5일차`,
          'exit-eve': `오늘 밤 청산 ${timing.dayCount}/5일차`,
          'exit-passed': '청산 확인 필요',
          unplanned: `계획 없음 · ${entry.plan.reason ?? ''}`,
        }[timing.stage];
  const fill = entry.fill ? ` · 체결 ${entry.fill.price.toFixed(2)} × ${entry.fill.size}주` : '';
  const realised =
    entry.fill && entry.close
      ? ` · 실현 ${formatPercent((entry.close.price / entry.fill.price - 1) * 100)}`
      : '';
  return `${entry.ticker} ${entry.signalSession} · ${stage} · 진입 ${formatSessionLabel(entry.plan.entrySession)} 시가 (시드니 ${formatSydneyTime(entry.plan.entryOpenAt)}) · 청산 ${formatSessionLabel(entry.plan.exitSession)} 종가 (시드니 ${formatSydneyTime(entry.plan.exitCloseAt)})${fill}${realised} · ${entry.source.kind === 'daily-report' ? '아침 보고' : '수동'}${entry.validatedUniverse ? '' : ' · 검증 범위 밖'}`;
}

/** Runs one subcommand and returns the text to print; nothing here sends a notification. */
export async function runPositionsCommand(
  parsed: PositionsArguments,
  dependencies: PositionLedgerDependencies = {}
): Promise<string> {
  const now = (dependencies.now ?? (() => new Date()))();
  switch (parsed.command) {
    case 'list': {
      const ledger = await readPositionLedger(dependencies);
      if (parsed.json) return JSON.stringify(ledger, null, 2);
      const lines = ledger.entries.map((entry) => describe(entry, now));
      if (ledger.unreadable) lines.push(`읽을 수 없는 장부 파일 ${ledger.unreadable}개`);
      return lines.join('\n') || '기록된 포지션 없음.';
    }
    case 'sync': {
      const result = await syncPositionsFromMarketScans(dependencies);
      if (parsed.json) return JSON.stringify(result, null, 2);
      return `동기화 완료 · 새 포지션 ${result.created.length}개 · 검사한 작업 ${result.scannedJobs}개 · 건너뜀 ${result.skippedJobs}개${result.created.length ? `\n${result.created.map((entry) => describe(entry, now)).join('\n')}` : ''}`;
    }
    case 'digest': {
      const digest = await buildPositionDigest({ ...dependencies, now });
      if (parsed.json) return JSON.stringify(digest, null, 2);
      return formatPositionDigest(digest) || '보유 계획에 표시할 항목 없음.';
    }
    case 'record-fill': {
      const entry = await recordPositionFill(
        {
          ticker: parsed.ticker!,
          session: parsed.session!,
          price: parsed.price!,
          size: parsed.size!,
          ...(parsed.note !== undefined ? { note: parsed.note } : {}),
        },
        dependencies
      );
      return parsed.json
        ? JSON.stringify(entry, null, 2)
        : `체결 기록 완료\n${describe(entry, now)}`;
    }
    case 'close': {
      const entry = await closePosition(
        {
          ticker: parsed.ticker!,
          session: parsed.session!,
          price: parsed.price!,
          ...(parsed.note !== undefined ? { note: parsed.note } : {}),
        },
        dependencies
      );
      return parsed.json
        ? JSON.stringify(entry, null, 2)
        : `청산 기록 완료\n${describe(entry, now)}`;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void (async () => {
    const output = await runPositionsCommand(parsePositionsArguments(process.argv.slice(2)));
    process.stdout.write(`${output}\n`);
  })().catch((error: unknown) => {
    logger.error(
      { reason: error instanceof Error ? error.message : 'unknown' },
      '포지션 명령 실행 오류. 인자와 장부 상태를 확인하세요.'
    );
    process.exitCode = 1;
  });
}
