import { buildTickerContext, runSignalsWithContext } from '@/optimization/engine';
import {
  type HistoricalOutcomesReport,
  summarizeHistoricalOutcomes,
} from '@/reports/historical-outcomes';
import { gateReasons } from '@/reports/signal-reasons';
import type { AnalystTargetsReport, getAnalystTargets } from '@/services/analyst-targets';
import type { analyzeTickerContext, TickerAnalysisContext } from '@/services/ticker-analysis';
import type { WhatsAppNotification } from '@/utils/whatsapp';

export interface StockReportAlertCandidate {
  ticker: string;
  decision: 'BUY' | 'SELL' | 'HOLD';
  dataAsOf: string | null;
  gateReasons?: readonly string[];
  reference?: {
    price: number;
    stopLoss: number;
    takeProfit: number;
    atr?: number;
  } | null;
  context?: TickerAnalysisContext;
}

export interface StockReportAlertInput {
  title: string;
  asOf: string;
  coverageSummary: string;
  lookbackDays: number;
  candidates: readonly StockReportAlertCandidate[];
}

export interface StockReportAlertDetail {
  ticker: string;
  dataAsOf: string | null;
  lookbackDays: number;
  decision: StockReportAlertCandidate['decision'] | null;
  gateReasons: readonly string[];
  historical: HistoricalOutcomesReport | null;
  analystTargets: AnalystTargetsReport | null;
}

export type StockReportAlertGenerator = (
  ticker: string,
  options: { lookbackDays: number; context?: TickerAnalysisContext }
) => Promise<StockReportAlertDetail>;

export interface StockReportAlertDependencies {
  generateReport?: StockReportAlertGenerator;
  analyzeTickerContext?: typeof analyzeTickerContext;
  getAnalystTargets?: typeof getAnalystTargets;
  /** Test-only override; production always bounds enrichment to 30 seconds. */
  timeBudgetMs?: number;
}

const MAX_DETAILS = 3;
const MAX_SUMMARY_LENGTH = 3000;
const TIME_BUDGET_MS = 30_000;
const TICKER = /^\^?[A-Z0-9]+(?:[.-][A-Z0-9]+)*(?:=[A-Z0-9]+)?$/;

function text(value: string, maximum: number): string {
  const clean = value
    .toWellFormed()
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu, ' ')
    .trim();
  let output = '';
  for (const character of clean) {
    if (output.length + character.length > maximum) break;
    output += character;
  }
  return output.trimEnd();
}

function number(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '자료 없음';
}

function count(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function frequency(rate: number | null, hits: number, samples: number): string {
  if (!count(samples) || samples === 0) return '자료 없음 (표본 0)';
  if (
    !count(hits) ||
    hits > samples ||
    rate === null ||
    !Number.isFinite(rate) ||
    rate < 0 ||
    rate > 100
  ) {
    return `자료 없음 (표본 ${samples})`;
  }
  return `${rate.toFixed(2)}% (${hits}/${samples})`;
}

function sourceUrl(value: string | null): string | null {
  if (!value || value.length > 2048 || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    // Public provenance never includes credential-bearing query/fragment data.
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function historyLines(history: HistoricalOutcomesReport | null): string[] {
  if (!history) return ['과거 5거래일 순수익 관측승률: 자료 없음.'];
  const { fixedHold, atrBarriers, method, period } = history;
  return [
    `과거 BUY 순수익 관측승률 ${frequency(fixedHold.winRatePct, fixedHold.wins, fixedHold.samples)}; 왕복비용 ${number(method.roundTripCostBps)}bps${fixedHold.samples > 0 && fixedHold.samples < 30 ? '; 소표본·해석 주의' : ''}.`,
    `관측기간 ${text(period.from ?? '자료 없음', 10)}~${text(period.to ?? '자료 없음', 10)}; 다음 시가 진입→5거래일 종가 청산.`,
    `ATR 경로 도달: 손절 ${frequency(atrBarriers.stopTouchRatePct, atrBarriers.stopTouched, atrBarriers.samples)}, 목표 ${frequency(atrBarriers.targetTouchRatePct, atrBarriers.targetTouched, atrBarriers.samples)}.`,
  ];
}

function targetLines(targets: AnalystTargetsReport | null): string[] {
  const lines: string[] = [];
  const provenance: string[] = [];
  const consensus = targets?.consensus;
  if (consensus) {
    const analysts = consensus.analystCount;
    lines.push(
      `목표가 합의 ${text(consensus.currency ?? '통화 미제공', 12)}: 평균 ${number(consensus.mean)}, 범위 ${number(consensus.low)}~${number(consensus.high)}, ${analysts !== null && count(analysts) ? `${analysts}명` : '인원 미제공'}.`,
      `합의 조회 ${text(consensus.retrievedAt, 30)}; ${text(consensus.source, 40)}.`
    );
    const url = sourceUrl(consensus.sourceUrl);
    if (url) provenance.push(`합의 출처 ${url}`);
  } else {
    lines.push('목표가 합의: 자료 없음.');
  }
  const update =
    targets?.recent.status === 'available'
      ? [...targets.recent.updates]
          .filter((item) => Number.isFinite(Date.parse(item.publishedAt)))
          .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))[0]
      : undefined;
  if (update) {
    lines.push(
      `관측자료 중 최신 개별: ${text(update.publishedAt, 10)} ${text(update.firm, 60)} ${number(update.targetPrice)} ${text(update.currency ?? '통화 미제공', 12)}; ${text(update.source, 40)}.`
    );
    const url = sourceUrl(update.sourceUrl);
    if (url && url !== sourceUrl(consensus?.sourceUrl ?? null)) provenance.push(`개별 출처 ${url}`);
  } else {
    lines.push('최근 개별 목표가: 자료 없음.');
  }
  return [...lines, ...provenance];
}

function candidateLines(
  candidate: StockReportAlertCandidate,
  detail: StockReportAlertDetail | undefined,
  reasonBudget: number
): { required: string[]; optional: string[] } {
  const action =
    candidate.decision === 'BUY'
      ? '다음 시가 조건부 진입'
      : candidate.decision === 'SELL'
        ? '보유 포지션 청산 경고'
        : '신규 진입 보류';
  const lines = [
    `${text(candidate.ticker, 32)} ${candidate.decision} (${action}); 원신호 종가일 ${text(candidate.dataAsOf ?? '자료 없음', 10)}.`,
  ];
  if (candidate.reference) {
    const reference = candidate.reference;
    lines.push(
      candidate.decision === 'BUY'
        ? `종가 참고 ${number(reference.price)}; ATR ${number(reference.atr)}; 손절 ${number(reference.stopLoss)}, 목표 ${number(reference.takeProfit)}.`
        : `종가 참고 ${number(reference.price)}.`
    );
  }
  const aligned =
    detail?.dataAsOf === candidate.dataAsOf && detail?.decision === candidate.decision;
  const reasons = candidate.gateReasons ?? (aligned ? detail?.gateReasons : undefined) ?? [];
  const reason = `원판정 근거: ${reasons.length ? text(reasons.map((item) => text(item, 90)).join(' / '), reasonBudget) : '자료 없음'}.`;
  if (detail && !aligned) {
    lines.push(
      `상세 재조회 ${text(detail.dataAsOf ?? '자료 없음', 10)} ${detail.decision ?? '자료 없음'}; 원판정 유지.`
    );
  }
  const targets =
    detail?.analystTargets?.ticker === candidate.ticker ? detail.analystTargets : null;
  const targetSummary = targetLines(targets);
  const sources = targetSummary.filter((line) => /^(?:합의|개별) 출처 /.test(line));
  const history = historyLines(aligned ? (detail?.historical ?? null) : null);
  return {
    required: [lines[0], reason, history[0], targetSummary[0], ...lines.slice(1)],
    optional: [
      ...history.slice(1),
      ...targetSummary.slice(1).filter((line) => !sources.includes(line)),
      ...sources,
    ],
  };
}

/** Each ticker block keeps whole lines; no final price or URL is sliced mid-value. */
export function formatStockReportWhatsAppNotification(
  input: StockReportAlertInput,
  details: readonly StockReportAlertDetail[]
): WhatsAppNotification {
  const candidates = input.candidates.slice(0, MAX_DETAILS);
  const header = [
    '과거 관측치이며 미래 수익 확률 아님. 신호점수는 승률 아님; BUY 표본은 중복될 수 있음.',
    '종가·ATR 가격은 체결가 아닌 참고값. ATR 도달률은 승률·손절 체결확률과 다름. 컨센서스 발표일·목표기간은 미제공.',
    `결과 요약: ${text(input.coverageSummary, 350)}`,
    `요청기간 ${input.lookbackDays}일; 상세 ${candidates.length}/${input.candidates.length}개 (최대 ${MAX_DETAILS}). 가격: 기존 Stock Checker 일봉 입력.`,
  ].join('\n');
  const blocks: string[] = [];
  const budget = candidates.length
    ? Math.floor((MAX_SUMMARY_LENGTH - header.length - candidates.length * 2) / candidates.length)
    : 0;
  for (const candidate of candidates) {
    const detail = details.find(
      (item) => item.ticker === candidate.ticker && item.lookbackDays === input.lookbackDays
    );
    const lines = candidateLines(candidate, detail, Math.min(400, Math.floor(budget / 6)));
    // Identity, original reason, net wins/sample, consensus mean and references
    // are reserved before auxiliary diagnostics and source links use the remainder.
    const block = [...lines.required];
    let length = block.join('\n').length;
    let omitted = false;
    const omission = '일부 상세·출처는 길이 제한으로 생략.';
    for (const line of lines.optional) {
      const separator = block.length ? 1 : 0;
      if (length + separator + line.length > budget - omission.length - 1) {
        omitted = true;
        continue;
      }
      block.push(line);
      length += separator + line.length;
    }
    if (omitted) block.push(omission);
    blocks.push(block.join('\n'));
  }
  return {
    title: text(input.title, 80),
    asOf: text(input.asOf, 60),
    summary: blocks.length ? `${header}\n\n${blocks.join('\n\n')}` : `${header}\n상세 후보 없음.`,
  };
}

function contextMatches(candidate: StockReportAlertCandidate): boolean {
  const context = candidate.context;
  return (
    !context ||
    (context.result.ticker === candidate.ticker &&
      context.result.date === candidate.dataAsOf &&
      context.pipelineResult.finalDecision === candidate.decision)
  );
}

async function loadDetail(
  ticker: string,
  options: { lookbackDays: number; context?: TickerAnalysisContext },
  dependencies: StockReportAlertDependencies
): Promise<StockReportAlertDetail> {
  const [context, analystTargets] = await Promise.all([
    options.context
      ? Promise.resolve(options.context)
      : (async () => {
          const analyze =
            dependencies.analyzeTickerContext ??
            (await import('@/services/ticker-analysis')).analyzeTickerContext;
          return analyze(ticker, null, { lookbackDays: options.lookbackDays });
        })().catch(() => null),
    (async () => {
      const targets =
        dependencies.getAnalystTargets ??
        (await import('@/services/analyst-targets')).getAnalystTargets;
      return targets(ticker);
    })().catch(() => null),
  ]);
  const historicalContext = context
    ? buildTickerContext(context.dailyPrices, context.spyCandles, context.sectorCandles)
    : null;
  return {
    ticker,
    dataAsOf: context?.result.date ?? null,
    lookbackDays: options.lookbackDays,
    decision: context?.pipelineResult.finalDecision ?? null,
    gateReasons: context ? gateReasons(context) : [],
    historical:
      historicalContext && context
        ? summarizeHistoricalOutcomes(
            ticker,
            historicalContext.data,
            runSignalsWithContext(historicalContext, ticker, context.config),
            { start: historicalContext.evaluationStart }
          )
        : null,
    analystTargets,
  };
}

/** Enrichment never sends messages. Only three sequential ticker jobs may start. */
export async function buildStockReportWhatsAppNotification(
  input: StockReportAlertInput,
  dependencies: StockReportAlertDependencies = {}
): Promise<WhatsAppNotification> {
  const requestedBudget = dependencies.timeBudgetMs ?? TIME_BUDGET_MS;
  const budget =
    Number.isFinite(requestedBudget) && requestedBudget > 0
      ? Math.min(requestedBudget, TIME_BUDGET_MS)
      : TIME_BUDGET_MS;
  const deadline = Date.now() + budget;
  const details: StockReportAlertDetail[] = [];
  const generate =
    dependencies.generateReport ?? ((ticker, options) => loadDetail(ticker, options, dependencies));
  const lookbackValid =
    Number.isInteger(input.lookbackDays) && input.lookbackDays >= 730 && input.lookbackDays <= 3650;
  const seen = new Set<string>();
  for (const candidate of input.candidates.slice(0, MAX_DETAILS)) {
    if (Date.now() >= deadline) break;
    if (
      !lookbackValid ||
      candidate.ticker.length > 32 ||
      !TICKER.test(candidate.ticker) ||
      !contextMatches(candidate) ||
      seen.has(candidate.ticker)
    )
      continue;
    seen.add(candidate.ticker);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout(undefined), Math.max(0, deadline - Date.now()));
      timer.unref?.();
    });
    const operation = Promise.resolve()
      .then(() =>
        generate(candidate.ticker, { lookbackDays: input.lookbackDays, context: candidate.context })
      )
      .catch(() => undefined);
    try {
      const detail = await Promise.race([operation, timeout]);
      if (
        detail &&
        detail.ticker === candidate.ticker &&
        detail.lookbackDays === input.lookbackDays
      )
        details.push(detail);
      if (!detail && Date.now() >= deadline) break;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return formatStockReportWhatsAppNotification(input, details);
}
