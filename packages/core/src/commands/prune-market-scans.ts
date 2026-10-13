import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pino from 'pino';
import { pruneMarketScreenJobs } from '@/reports/market-screen-store';

const logger = pino({ name: 'prune-market-scans' }, process.stderr);

export function parsePruneArguments(arguments_: readonly string[]): {
  olderThanDays: number;
  dryRun: boolean;
} {
  let olderThanDays = 30;
  let dryRun = false;
  for (const argument of arguments_) {
    const days = /^--days=(\d{1,4})$/.exec(argument);
    if (days) olderThanDays = Number(days[1]);
    else if (argument === '--dry-run') dryRun = true;
    else throw new TypeError('Use --days=<1-3650> and optionally --dry-run.');
  }
  if (olderThanDays < 1 || olderThanDays > 3650)
    throw new TypeError('Use --days=<1-3650> and optionally --dry-run.');
  return { olderThanDays, dryRun };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void (async () => {
    const options = parsePruneArguments(process.argv.slice(2));
    const result = await pruneMarketScreenJobs(options);
    logger.info(
      {
        olderThanDays: result.olderThanDays,
        dryRun: result.dryRun,
        pruned: result.pruned.length,
        kept: result.kept.length,
        prunedJobs: result.pruned,
      },
      result.dryRun
        ? '정리 대상 시장 스캔 작업 (미실행)'
        : '오래된 시장 스캔 작업을 보관함으로 이동했습니다'
    );
  })().catch((error: unknown) => {
    logger.error(
      { message: error instanceof Error ? error.message : 'unknown' },
      '시장 스캔 정리 실패'
    );
    process.exitCode = 1;
  });
}
