import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pino from 'pino';
import { QLD_STRATEGY_ID, type QldStrategyPoint, replayQldStrategy } from '@/services/qld-strategy';
import { fetchYahooDaily } from '@/services/yahoo-finance';

const logger = pino({ name: 'qld-strategy' }, process.stderr);
/** QQQ's first session; the replay starts here so the held weight is reproducible. */
const HISTORY_START = new Date('1999-03-10T00:00:00Z');

export interface QldStrategyReport {
  strategyId: typeof QLD_STRATEGY_ID;
  /** Completed QQQ session the weight was decided on. */
  asOf: string;
  qqqClose: number;
  volatility20Pct: number;
  targetWeightPct: number;
  /** QLD share of the account to hold from the next open; the rest is cash. */
  weightPct: number;
  previousWeightPct: number;
  action: 'hold' | 'buy' | 'sell';
  /** Session on which the held weight last changed. */
  lastChange: string | null;
  /** Comparison only: the variant that adds to QLD as QQQ falls from its 252-session high. */
  averagingDown: { fallFromHighPct: number; ladderLevel: number; weightPct: number };
}

/** Summarises the latest decision of a replayed series. */
export function summarizeQldStrategy(points: readonly QldStrategyPoint[]): QldStrategyReport {
  const latest = points.at(-1);
  if (!latest) throw new RangeError('The QLD rule needs more than 200 QQQ sessions.');
  const previous = points.at(-2)?.weight ?? 0;
  let lastChange: string | null = null;
  for (let i = points.length - 1; i >= 1; i--) {
    if (points[i].weight !== points[i - 1].weight) {
      lastChange = points[i].date;
      break;
    }
  }
  const percent = (value: number) => Math.round(value * 1000) / 10;
  return {
    strategyId: QLD_STRATEGY_ID,
    asOf: latest.date,
    qqqClose: latest.close,
    volatility20Pct: percent(latest.volatility20),
    targetWeightPct: percent(latest.target),
    weightPct: percent(latest.weight),
    previousWeightPct: percent(previous),
    action: latest.weight === previous ? 'hold' : latest.weight > previous ? 'buy' : 'sell',
    lastChange,
    averagingDown: {
      fallFromHighPct: percent(latest.fallFromHigh),
      ladderLevel: latest.ladderLevel,
      weightPct: percent(latest.averagingDownWeight),
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void (async () => {
    const rows = await fetchYahooDaily('QQQ', HISTORY_START, new Date());
    const report = summarizeQldStrategy(
      replayQldStrategy(
        rows.map((row) => ({ date: row.date.toISOString().slice(0, 10), close: row.close }))
      )
    );
    logger.info(
      report,
      `QLD 연구 규칙 · ${report.asOf} 종가 기준 · 다음 시가부터 QLD ${report.weightPct}% / 현금 ${Math.round((100 - report.weightPct) * 10) / 10}% · 물타기 변형은 QLD ${report.averagingDown.weightPct}% (연구 규칙이며 주문이 아님)`
    );
  })().catch((error: unknown) => {
    logger.error(
      { message: error instanceof Error ? error.message : 'unknown' },
      'QLD 규칙 계산 실패'
    );
    process.exitCode = 1;
  });
}
