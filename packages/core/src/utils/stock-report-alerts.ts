import { buildTickerContext, runSignalsWithContext } from '@/optimization/engine';
import {
  type HistoricalOutcomesReport,
  summarizeHistoricalOutcomes,
} from '@/reports/historical-outcomes';
import { gateReasons } from '@/reports/signal-reasons';
import type { AnalystTargetsReport, getAnalystTargets } from '@/services/analyst-targets';
import type { analyzeTickerContext, TickerAnalysisContext } from '@/services/ticker-analysis';
import type { PipelineConfig } from '@/types';
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
  /** Complete configuration frozen when the saved screening decisions were generated. */
  pipelineConfig?: PipelineConfig;
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
  options: {
    lookbackDays: number;
    context?: TickerAnalysisContext;
    pipelineConfig?: PipelineConfig;
  }
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

function retrievedAt(value: string): string {
  const instant = Date.parse(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(instant) ||
    new Date(instant).toISOString() !== value
  ) {
    return text(value, 30);
  }
  return `${value.slice(0, 10)} ${value.slice(11, 16)} UTC`;
}

function historyLines(history: HistoricalOutcomesReport | null): string[] {
  if (!history) return ['승률: 자료 없음 (과거 BUY 5거래일 순수익)', '관측기간: 자료 없음'];
  const { fixedHold, atrBarriers, method, period } = history;
  return [
    `승률: ${frequency(fixedHold.winRatePct, fixedHold.wins, fixedHold.samples)}${fixedHold.samples > 0 && fixedHold.samples < 30 ? ' · 소표본' : ''}`,
    `관측기간: ${text(period.from ?? '자료 없음', 10)} ~ ${text(period.to ?? '자료 없음', 10)}`,
    `방식: 다음 시가 진입→5거래일 종가 청산 · 왕복비용 ${number(method.roundTripCostBps)}bps`,
    `ATR 도달률(체결률 아님): 손절 ${frequency(atrBarriers.stopTouchRatePct, atrBarriers.stopTouched, atrBarriers.samples)} · 목표 ${frequency(atrBarriers.targetTouchRatePct, atrBarriers.targetTouched, atrBarriers.samples)}`,
  ];
}

function targetLines(targets: AnalystTargetsReport | null): string[] {
  const lines: string[] = [];
  const provenance: string[] = [];
  const consensus = targets?.consensus;
  if (consensus) {
    const analysts = consensus.analystCount;
    lines.push(
      `합의: 평균 ${number(consensus.mean)} ${text(consensus.currency ?? '통화 미제공', 12)} · 범위 ${number(consensus.low)}~${number(consensus.high)} · ${analysts !== null && count(analysts) ? `${analysts}명` : '인원 미제공'}`,
      `합의 조회: ${retrievedAt(consensus.retrievedAt)} · ${text(consensus.source, 40)}`,
      '합의 발표일: 미제공 · 목표기간(합의·개별): 미제공'
    );
    const url = sourceUrl(consensus.sourceUrl);
    if (url) provenance.push(`합의 출처 ${url}`);
  } else {
    lines.push('합의: 자료 없음');
  }
  const update =
    targets?.recent.status === 'available'
      ? [...targets.recent.updates]
          .filter((item) => Number.isFinite(Date.parse(item.publishedAt)))
          .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))[0]
      : undefined;
  if (update) {
    lines.push(
      `개별 최근(조회 자료): ${text(update.publishedAt, 10)} ${text(update.firm, 60)} · ${number(update.targetPrice)} ${text(update.currency ?? '통화 미제공', 12)} · ${text(update.source, 40)}`
    );
    const url = sourceUrl(update.sourceUrl);
    if (url && url !== sourceUrl(consensus?.sourceUrl ?? null)) provenance.push(`개별 출처 ${url}`);
  } else {
    lines.push('최근 개별: 자료 없음');
  }
  return [...lines, ...provenance];
}

/** Local notification wording only; the signal engine's original reasons stay intact. */
function reasonText(value: string): string {
  const clean = text(value, 600);
  const trend = /^BUY trend gate: (.*); (passed|blocked)\.$/.exec(clean);
  if (trend) {
    const gaussian = /^Gaussian Channel: filter (up|down|flat), isGreen=(true|false)$/.exec(
      trend[1]
    );
    const directions: Record<string, string> = { up: '상승', down: '하락', flat: '횡보' };
    const explanation = gaussian
      ? `가우시안 채널 ${directions[gaussian[1]]} · ${gaussian[2] === 'true' ? '녹색' : '녹색 아님'}`
      : trend[1]
          .replace('trend gate disabled', '추세 필터 비활성')
          .replace('insufficient data for SMA', 'SMA 자료 부족')
          .replace(/(\d+)\/3 conditions met/, '조건 $1/3 충족')
          .replace(' (sideways relaxed)', ' (횡보 기준 완화)');
    return `추세: ${trend[2] === 'passed' ? '통과' : '차단'} · ${explanation}`;
  }
  const score = /^BUY score (.+) \/ threshold (.+); SELL score (.+) \/ threshold (.+)\.$/.exec(
    clean
  );
  if (score) return `점수: 매수 ${score[1]}/${score[2]} · 매도 ${score[3]}/${score[4]} (점수/기준)`;
  const confluence = /^Confluence: (\d+\/\d+); (passed|not passed or not evaluated)\.$/.exec(clean);
  if (confluence)
    return `지표 일치: ${confluence[1]} · ${confluence[2] === 'passed' ? '통과' : '미통과 또는 미평가'}`;
  const reversal = /^Reversal: (.+); trigger (.+)\.$/.exec(clean);
  if (reversal) {
    const statuses: Record<string, string> = {
      confirmed: '확인',
      rejected: '미확인',
    };
    const triggers: Record<string, string> = {
      both: '양봉·거래량 급증',
      bullish_candle: '양봉',
      volume_spike: '거래량 급증',
      'none / not evaluated': '없음 또는 미평가',
    };
    return `반전: ${statuses[reversal[1]] ?? reversal[1]} · ${triggers[reversal[2]] ?? reversal[2]}`;
  }
  const institutional =
    /^Institutional score (.+); (passed|below threshold)\. The institutional strategy blends this score into BUY scoring\.$/.exec(
      clean
    );
  if (institutional)
    return `기관 점수: ${institutional[1]} · ${institutional[2] === 'passed' ? '통과' : '기준 미달'} (매수 점수 반영)`;
  const explanations: Record<string, string> = {
    'The entry-quality gate rejected this score-qualified BUY setup.':
      '진입 품질: 매수 점수는 충족했지만 품질 필터가 차단',
    'No entry: the complete BUY path did not pass or neither eligible decision qualified.':
      '신규 진입 보류: 매수 경로 미충족 또는 매수·매도 기준 미충족',
    'SELL is a long-holder exit warning, not a short-entry recommendation.':
      '매도: 기존 보유분 청산 경고 (공매도 진입 권고 아님)',
    'BUY qualifies at the completed close; execution remains conditional on the next session open.':
      '매수: 종가 기준 충족 (다음 거래일 시가에 조건부 실행)',
  };
  return explanations[clean] ?? clean;
}

interface CandidateSection {
  heading?: string;
  required: string[];
  optional: string[];
}

function candidateSections(
  candidate: StockReportAlertCandidate,
  detail: StockReportAlertDetail | undefined,
  reasonBudget: number
): CandidateSection[] {
  const action =
    candidate.decision === 'BUY'
      ? '다음 시가 조건부 진입'
      : candidate.decision === 'SELL'
        ? '보유 포지션 청산 경고'
        : '신규 진입 보류';
  const identity = [
    `*${text(candidate.ticker, 32)} · ${candidate.decision}*`,
    `판정: ${action} · 종가일 ${text(candidate.dataAsOf ?? '자료 없음', 10)}`,
  ];
  const referenceLines: string[] = [];
  const referenceOptional: string[] = [];
  if (candidate.reference) {
    const reference = candidate.reference;
    referenceLines.push(`종가: ${number(reference.price)}`);
    if (candidate.decision === 'BUY') {
      referenceLines.push(
        `손절: ${number(reference.stopLoss)} · 목표: ${number(reference.takeProfit)}`
      );
      referenceOptional.push(`ATR: ${number(reference.atr)} · 진입 시가 미확정`);
    }
  } else {
    referenceLines.push('종가: 자료 없음');
  }
  const aligned =
    detail?.dataAsOf === candidate.dataAsOf && detail?.decision === candidate.decision;
  const reasons = candidate.gateReasons ?? (aligned ? detail?.gateReasons : undefined) ?? [];
  const reasonLines = reasons.map(reasonText);
  const blocker = reasons.findIndex((line) =>
    /entry-quality gate rejected|; blocked\.|; not passed or not evaluated\.|; below threshold\./.test(
      line
    )
  );
  const qualityBlocker = reasons.findIndex((line) => /entry-quality gate rejected/.test(line));
  const holdingReason = reasons.findIndex((line) => /^No entry:/.test(line));
  const mainReason =
    qualityBlocker >= 0
      ? qualityBlocker
      : blocker >= 0
        ? blocker
        : candidate.decision === 'HOLD' && holdingReason >= 0
          ? holdingReason
          : 0;
  const firstReason = reasonLines[mainReason] ?? '자료 없음';
  const shortened = text(firstReason, reasonBudget);
  const reason = `• ${shortened}${shortened.length < firstReason.length ? '…' : ''}`;
  const scoreReason = reasons.findIndex((line) => /^BUY score .+ \/ threshold /.test(line));
  const requiredReasons = [reason];
  if (scoreReason >= 0 && scoreReason !== mainReason)
    requiredReasons.push(`• ${reasonLines[scoreReason]}`);
  if (detail && !aligned) {
    identity.push(
      `재조회: ${text(detail.dataAsOf ?? '자료 없음', 10)} ${detail.decision ?? '자료 없음'} · 원판정 유지`
    );
  }
  const targets =
    detail?.analystTargets?.ticker === candidate.ticker ? detail.analystTargets : null;
  const targetSummary = targetLines(targets);
  const sources = targetSummary.filter((line) => /^(?:합의|개별) 출처 /.test(line));
  const history = historyLines(aligned ? (detail?.historical ?? null) : null);
  return [
    { required: identity, optional: [] },
    { heading: '과거 BUY 순수익 관측', required: history.slice(0, 3), optional: history.slice(3) },
    { heading: '참고 가격 (통화 미제공)', required: referenceLines, optional: referenceOptional },
    {
      heading: '애널리스트 목표가',
      required: targetSummary.slice(0, targets?.consensus ? 3 : 1),
      optional: targetSummary
        .slice(targets?.consensus ? 3 : 1)
        .filter((line) => !sources.includes(line)),
    },
    {
      heading: '원판정 근거',
      required: requiredReasons,
      optional: reasonLines
        .filter((_, index) => index !== mainReason && index !== scoreReason)
        .map((line) => `• ${line}`),
    },
    { heading: '출처', required: [], optional: sources },
  ];
}

/** Each ticker block keeps whole lines; no final price or URL is sliced mid-value. */
export function formatStockReportWhatsAppNotification(
  input: StockReportAlertInput,
  details: readonly StockReportAlertDetail[]
): WhatsAppNotification {
  const candidates = input.candidates.slice(0, MAX_DETAILS);
  const blocks: string[] = [];
  const budget = candidates.length
    ? Math.floor((MAX_SUMMARY_LENGTH - (candidates.length - 1) * 2) / candidates.length)
    : 0;
  for (const candidate of candidates) {
    const detail = details.find(
      (item) => item.ticker === candidate.ticker && item.lookbackDays === input.lookbackDays
    );
    const sections = candidateSections(candidate, detail, Math.min(140, Math.floor(budget / 8)));
    const selected = sections.map((section) => [...section.required]);
    const render = () =>
      sections
        .map((section, index) =>
          selected[index].length
            ? [...(section.heading ? [`*${section.heading}*`] : []), ...selected[index]].join('\n')
            : ''
        )
        .filter(Boolean)
        .join('\n\n');
    let omitted = false;
    const omission = '일부 상세·출처는 길이 제한으로 생략.';
    // Reserve each stock's period/method, original reason, wins/sample,
    // consensus retrieval and reference prices before adding auxiliary lines.
    const priority = [3, 5, 4, 1, 2];
    for (const index of priority) {
      for (const line of sections[index].optional) {
        selected[index].push(line);
        if (render().length > budget - omission.length - 2) {
          selected[index].pop();
          omitted = true;
        }
      }
    }
    blocks.push(`${render()}${omitted ? `\n${omission}` : ''}`);
  }
  return {
    title: text(input.title, 80),
    asOf: text(input.asOf, 60),
    summary: blocks.length ? blocks.join('\n\n') : '상세 후보 없음.',
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
  options: {
    lookbackDays: number;
    context?: TickerAnalysisContext;
    pipelineConfig?: PipelineConfig;
  },
  dependencies: StockReportAlertDependencies
): Promise<StockReportAlertDetail> {
  const [context, analystTargets] = await Promise.all([
    options.context
      ? Promise.resolve(options.context)
      : (async () => {
          const analyze =
            dependencies.analyzeTickerContext ??
            (await import('@/services/ticker-analysis')).analyzeTickerContext;
          return analyze(ticker, null, {
            lookbackDays: options.lookbackDays,
            ...(options.pipelineConfig ? { pipelineConfig: options.pipelineConfig } : {}),
          });
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
  const pipelineConfig = input.pipelineConfig ? structuredClone(input.pipelineConfig) : undefined;
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
        generate(candidate.ticker, {
          lookbackDays: input.lookbackDays,
          context: candidate.context,
          ...(!candidate.context && pipelineConfig
            ? { pipelineConfig: structuredClone(pipelineConfig) }
            : {}),
        })
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
