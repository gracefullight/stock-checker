import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pino from 'pino';
import {
  type StrategyValidationOptions,
  validateStrategyDataset,
} from '@/reports/strategy-validation';

const logger = pino({ name: 'strategy-validation' }, process.stderr);

export function parseStrategyValidationArguments(arguments_: string[]): StrategyValidationOptions {
  const values = new Map<string, string>();
  for (const argument of arguments_) {
    const match = /^--(dataset|output|config|tickers|workers)=(.+)$/.exec(argument);
    if (!match || values.has(match[1]))
      throw new TypeError(
        'Use unique --dataset=, --output=, --config=, --tickers=, --workers= options'
      );
    values.set(match[1], match[2]);
  }
  const datasetDirectory = values.get('dataset');
  if (!datasetDirectory || !path.isAbsolute(datasetDirectory))
    throw new TypeError('--dataset requires an absolute cached dataset directory');
  const workerText = values.get('workers');
  if (workerText && !/^[1-6]$/.test(workerText)) throw new TypeError('--workers must be 1–6');
  return {
    datasetDirectory,
    ...(values.has('output') ? { outputFile: path.resolve(values.get('output')!) } : {}),
    ...(values.has('config') ? { configPath: path.resolve(values.get('config')!) } : {}),
    ...(values.has('tickers')
      ? {
          tickers: values
            .get('tickers')!
            .split(',')
            .map((ticker) => ticker.trim().toUpperCase()),
        }
      : {}),
    ...(workerText ? { workers: Number(workerText) } : {}),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void validateStrategyDataset(parseStrategyValidationArguments(process.argv.slice(2)), {
    onProgress(progress) {
      if (progress.completed % 25 === 0 || progress.completed === progress.total)
        logger.info(progress, '고정 전략 평가 진행');
    },
  })
    .then(({ report, outputFile }) => {
      if (report.status === 'invalid') {
        logger.error(
          { outputFile, reason: 'source-changed-during-measurement' },
          '측정 중 전략 소스가 변경되어 검증 결과를 무효 처리했습니다.'
        );
        process.exitCode = 1;
        return;
      }
      logger.info(
        {
          outputFile,
          requested: report.requestedTickers,
          evaluated: report.evaluatedTickers,
          unavailable: report.unavailableTickers,
          observations: report.full.observations,
          nonOverlappingTrades: report.full.nonOverlappingTrades,
          configSha256: report.configSha256,
          sourceChangedDuringMeasurement: report.sourceChangedDuringMeasurement,
        },
        '고정 전략 검증 완료'
      );
    })
    .catch(() => {
      logger.error('고정 전략 검증 실패. 데이터 경로·입력 형식·작업자 상태를 확인하세요.');
      process.exitCode = 1;
    });
}
