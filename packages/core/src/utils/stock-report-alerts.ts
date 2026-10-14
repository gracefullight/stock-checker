import { DateTime } from 'luxon';
import { buildTickerContext, runSignalsWithContext } from '@/optimization/engine';
import {
  type HistoricalOutcomesReport,
  summarizeHistoricalOutcomes,
} from '@/reports/historical-outcomes';
import { gateReasons } from '@/reports/signal-reasons';
import type { AnalystTargetsReport, getAnalystTargets } from '@/services/analyst-targets';
import type { analyzeTickerContext, TickerAnalysisContext } from '@/services/ticker-analysis';
import type { PipelineConfig, PipelineResult } from '@/types';
import {
  formatScreeningOutcome,
  formatScreenTimestamp,
  formatShortJobId,
  type ScreeningNotificationContext,
} from '@/utils/screening-diagnostics';
import {
  latestCompletedSession,
  NYSE_EARLY_CLOSES,
  parseSessionDate,
  sessionCloseAt,
  sessionOpenAt,
  sessionsAfter,
  US_MARKET_TIMEZONE,
} from '@/utils/us-market-calendar';
import { sanitizeNotificationText, type WhatsAppNotification } from '@/utils/whatsapp';

export interface StockReportAlertCandidate {
  ticker: string;
  decision: 'BUY' | 'SELL' | 'HOLD';
  dataAsOf: string | null;
  gateReasons?: readonly string[];
  /** Structured gates from the saved decision; feeds the plain-language setup line. */
  gates?: PipelineResult['gateResults'];
  reference?: {
    price: number;
    stopLoss: number;
    takeProfit: number;
    atr?: number;
  } | null;
  context?: TickerAnalysisContext;
}

export interface PositionSizing {
  /** Maximum concurrent positions; each BUY is sized as 1/maxPositions of capital. */
  maxPositions: number;
  /** Optional trading capital (currency unknown to the formatter). */
  capital?: number;
}

export interface StockReportAlertInput {
  title: string;
  asOf: string;
  lookbackDays: number;
  /** Complete configuration frozen when the saved screening decisions were generated. */
  pipelineConfig?: PipelineConfig;
  candidates: readonly StockReportAlertCandidate[];
  screening?: ScreeningNotificationContext;
  /** Completed US session the decisions refer to; derived from candidates or the calendar otherwise. */
  usSession?: string | null;
  /** Saved job id; rendered as a short reference. */
  jobId?: string;
  /** 'configured-universe' (validated) or 'finviz-candidates' (outside the measured universe). */
  universeSource?: string;
  /** Every ticker matching the screening decision, so names beyond the detailed ones are listed. */
  matchedTickers?: readonly string[];
  /** Position-size hint; resolved from the environment when omitted. */
  sizing?: PositionSizing;
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

/**
 * In-sample remeasurement of the leader-pullback rule on the configured universe
 * (docs/validation/leader-pullback-2026-10-06.md). Non-overlapping next-open to
 * fifth-close trades after 10 bps; not a future win probability.
 */
export const VALIDATED_STRATEGY_COHORT = Object.freeze({
  trades: 155,
  wins: 89,
  winRatePct: 57.4,
  meanNetReturnPct: 0.63,
  worstTradePct: -13.6,
  entries: { from: '2019-08', to: '2026-09' },
});

const MAX_DETAILS = 3;
const MAX_SUMMARY_LENGTH = 3000;
const TIME_BUDGET_MS = 30_000;
const TICKER = /^\^?[A-Z0-9]+(?:[.-][A-Z0-9]+)*(?:=[A-Z0-9]+)?$/;
const MIN_PER_TICKER_SAMPLES = 10;
const DEFAULT_MAX_POSITIONS = 5;
const SYDNEY = 'Australia/Sydney';
const WEEKDAYS_KO = ['월', '화', '수', '목', '금', '토', '일'];

const text = (value: string, maximum: number) => sanitizeNotificationText(value, maximum);

function number(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '자료 없음';
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
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
  const formatted = formatScreenTimestamp(value);
  return formatted === value ? text(value, 30) : formatted;
}

/** Reads STOCK_CHECKER_MAX_POSITIONS (default 5) and STOCK_CHECKER_CAPITAL; invalid values fall back. */
export function resolvePositionSizing(
  environment: NodeJS.ProcessEnv = process.env
): PositionSizing {
  const positions = environment.STOCK_CHECKER_MAX_POSITIONS?.trim();
  const capital = environment.STOCK_CHECKER_CAPITAL?.trim();
  const maxPositions =
    positions && /^\d{1,3}$/.test(positions) && Number(positions) >= 1 && Number(positions) <= 100
      ? Number(positions)
      : DEFAULT_MAX_POSITIONS;
  const amount = capital && /^\d{1,15}(?:\.\d{1,2})?$/.test(capital) ? Number(capital) : undefined;
  return amount && amount > 0 ? { maxPositions, capital: amount } : { maxPositions };
}

function validSizing(sizing: PositionSizing | undefined): PositionSizing {
  if (!sizing || !Number.isSafeInteger(sizing.maxPositions) || sizing.maxPositions < 1) {
    return { maxPositions: DEFAULT_MAX_POSITIONS };
  }
  const capital =
    typeof sizing.capital === 'number' && Number.isFinite(sizing.capital) && sizing.capital > 0
      ? sizing.capital
      : undefined;
  return capital
    ? { maxPositions: Math.min(100, sizing.maxPositions), capital }
    : { maxPositions: Math.min(100, sizing.maxPositions) };
}

function isoDate(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function usDay(date: string): string {
  const parsed = DateTime.fromISO(date, { zone: US_MARKET_TIMEZONE });
  return parsed.isValid
    ? `${parsed.toFormat('MM-dd')}(${WEEKDAYS_KO[parsed.weekday - 1]})`
    : text(date, 10);
}

function sydneyTime(millis: number): string {
  const local = DateTime.fromMillis(millis, { zone: SYDNEY });
  return `${local.toFormat('MM-dd')}(${WEEKDAYS_KO[local.weekday - 1]}) ${local.toFormat('HH:mm')}`;
}

/** Entry at the next session open and exit at the fifth session close, from the shared calendar. */
export function tradePlanLines(dataAsOf: string | null): string[] {
  const session = isoDate(dataAsOf);
  const sessions = session && parseSessionDate(session) ? sessionsAfter(session, 5) : null;
  if (!sessions) {
    return [
      '진입: 다음 세션 시가 · 조건 없음 · 가격 미정 (달력 범위 밖, 날짜 미산정)',
      '청산: 5번째 세션 종가',
    ];
  }
  const [entry] = sessions;
  const exit = sessions[4];
  const early = NYSE_EARLY_CLOSES.has(exit);
  return [
    `진입: ${usDay(entry)} 시가 → 시드니 ${sydneyTime(sessionOpenAt(entry))} · 조건 없음 · 가격 미정`,
    `청산: ${usDay(exit)} 종가 → 시드니 ${sydneyTime(sessionCloseAt(exit))} · 5번째 세션${early ? ' · 조기 폐장 13:00 ET' : ''}`,
  ];
}

function sizingLine(sizing: PositionSizing): string {
  const share = `자본의 1/${sizing.maxPositions}`;
  const amount =
    sizing.capital !== undefined
      ? ` ≈ ${(sizing.capital / sizing.maxPositions).toLocaleString('en-US', { maximumFractionDigits: 0 })} (자본 ${sizing.capital.toLocaleString('en-US', { maximumFractionDigits: 0 })})`
      : '';
  return `비중: ${share}${amount} · 동시 최대 ${sizing.maxPositions}종목`;
}

function cohortLine(): string {
  const cohort = VALIDATED_STRATEGY_COHORT;
  return `검증 기대치(표본 내 ${cohort.trades}건, ${cohort.entries.from}~${cohort.entries.to}): 승률 ${cohort.winRatePct.toFixed(1)}% · 평균 ${signed(cohort.meanNetReturnPct)} · 최악 ${cohort.worstTradePct.toFixed(1)}% · 미래 확률 아님`;
}

function month(value: string | null): string {
  return value ? text(value, 7) : '자료 없음';
}

function historyLines(history: HistoricalOutcomesReport | null): string[] {
  if (!history) return ['종목 과거 BUY: 자료 없음 (5거래일 순수익)'];
  const { fixedHold, atrBarriers, method, period } = history;
  const samples = count(fixedHold.samples) ? fixedHold.samples : 0;
  const window = `${month(period.from)}~${month(period.to)}`;
  if (samples === 0) return [`종목 과거 BUY: 0건 · ${window} · 표본 없음`];
  if (samples < MIN_PER_TICKER_SAMPLES) {
    const wins = count(fixedHold.wins) && fixedHold.wins <= samples ? fixedHold.wins : null;
    return [
      `종목 과거 BUY: ${samples}건${wins === null ? '' : ` 중 ${wins}승`} · ${window} · 표본 부족(비율 생략)`,
      `방식: 다음 시가 진입→5거래일 종가 청산 · 왕복비용 ${number(method.roundTripCostBps)}bps`,
    ];
  }
  return [
    `승률: ${frequency(fixedHold.winRatePct, fixedHold.wins, samples)}${samples < 30 ? ' · 소표본' : ''}`,
    `관측기간: ${text(period.from ?? '자료 없음', 10)} ~ ${text(period.to ?? '자료 없음', 10)}`,
    `방식: 다음 시가 진입→5거래일 종가 청산 · 왕복비용 ${number(method.roundTripCostBps)}bps`,
    `손절·목표선 도달 비율(체결률 아님): 손절 ${frequency(atrBarriers.stopTouchRatePct, atrBarriers.stopTouched, atrBarriers.samples)} · 목표 ${frequency(atrBarriers.targetTouchRatePct, atrBarriers.targetTouched, atrBarriers.samples)}`,
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
      '매수: 종가 기준 충족 · 다음 세션 시가 진입 (조건 없음 · 가격 미정)',
  };
  return explanations[clean] ?? clean;
}

const BLOCKED_REASON =
  /entry-quality gate rejected|; blocked\.|; not passed or not evaluated\.|; below threshold\./;

function lastBar(candidate: StockReportAlertCandidate) {
  const context = candidate.context;
  if (!context || !candidate.dataAsOf) return null;
  const bar = context.dailyPrices.at(-1);
  return bar && bar.date.toISOString().slice(0, 10) === candidate.dataAsOf ? bar : null;
}

/** One plain-language line built from the structured gates and the frozen quality rules. */
function setupLine(
  candidate: StockReportAlertCandidate,
  config: PipelineConfig | undefined
): string {
  const gate = config?.qualityGate;
  const components =
    candidate.gates?.institutional.components ??
    candidate.context?.pipelineResult.gateResults.institutional.components;
  const bar = lastBar(candidate);
  const ibs =
    bar && bar.high > bar.low && Number.isFinite(bar.close)
      ? (bar.close - bar.low) / (bar.high - bar.low)
      : null;
  const reference = candidate.reference;
  const atrPct =
    reference &&
    typeof reference.atr === 'number' &&
    Number.isFinite(reference.atr) &&
    Number.isFinite(reference.price) &&
    reference.price > 0
      ? (reference.atr / reference.price) * 100
      : null;
  const parts: string[] = [];
  if (gate?.enabled && gate.rsMin !== undefined) {
    const values =
      components && Number.isFinite(components.rsSpy) && Number.isFinite(components.rsSector)
        ? ` RS ${components.rsSpy.toFixed(2)}/${components.rsSector.toFixed(2)}`
        : '';
    parts.push(`시장·섹터 대비 강세${values} (기준 ≥ ${gate.rsMin})`);
  }
  if (gate?.enabled && gate.requireBelowSma50) parts.push('50일선 아래 눌림');
  if (gate?.enabled && Number.isFinite(gate.ibsMax)) {
    parts.push(
      `종가 저점권 IBS${ibs === null ? '' : ` ${ibs.toFixed(2)}`} (기준 < ${gate.ibsMax})`
    );
  }
  if (gate?.enabled && Number.isFinite(gate.atrPctMax)) {
    parts.push(
      `일변동폭${atrPct === null ? '' : ` ${atrPct.toFixed(1)}%`} (기준 < ${gate.atrPctMax}%)`
    );
  }
  return parts.length
    ? `셋업: 강한 주도주의 차분한 눌림 · ${parts.join(' · ')}`
    : '셋업: 강한 주도주의 차분한 눌림 매수 (세부 기준 미제공)';
}

interface CandidateSection {
  key: 'identity' | 'plan' | 'history' | 'reference' | 'targets' | 'reasons' | 'sources';
  heading?: string;
  required: string[];
  optional: string[];
}

function candidateSections(
  candidate: StockReportAlertCandidate,
  detail: StockReportAlertDetail | undefined,
  reasonBudget: number,
  config: PipelineConfig | undefined,
  sizing: PositionSizing
): CandidateSection[] {
  const buy = candidate.decision === 'BUY';
  const action = buy
    ? '다음 세션 시가 진입 (조건 없음 · 가격 미정)'
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
    if (buy) {
      referenceOptional.push(
        `손절 ${number(reference.stopLoss)} · 목표 ${number(reference.takeProfit)} · ATR 기준, 검증 규칙 미포함`,
        `평균 가격 변동폭: ${number(reference.atr)} · 진입 시가 미확정`
      );
    }
  } else {
    referenceLines.push('종가: 자료 없음');
  }
  const aligned =
    detail?.dataAsOf === candidate.dataAsOf && detail?.decision === candidate.decision;
  const rules = config ?? candidate.context?.config;
  const reversalDisabled = rules?.reversalConfirm.enabled === false;
  const reasons = (
    candidate.gateReasons ??
    (aligned ? detail?.gateReasons : undefined) ??
    []
  ).filter((line) => !(reversalDisabled && /^Reversal: /.test(line)));
  const reasonLines = reasons.map(reasonText);
  const scoreReason = reasons.findIndex((line) => /^BUY score .+ \/ threshold /.test(line));
  let mainReason: number;
  if (buy) {
    // Headline: the qualifying line, else the first passed/neutral line; never a failed check.
    const qualifies = reasons.findIndex((line) => /^BUY qualifies/.test(line));
    const clean = reasons.findIndex(
      (line, index) => index !== scoreReason && !BLOCKED_REASON.test(line)
    );
    mainReason = qualifies >= 0 ? qualifies : clean >= 0 ? clean : Math.max(scoreReason, 0);
  } else {
    const blocker = reasons.findIndex((line) => BLOCKED_REASON.test(line));
    const qualityBlocker = reasons.findIndex((line) => /entry-quality gate rejected/.test(line));
    const holdingReason = reasons.findIndex((line) => /^No entry:/.test(line));
    mainReason =
      qualityBlocker >= 0
        ? qualityBlocker
        : blocker >= 0
          ? blocker
          : candidate.decision === 'HOLD' && holdingReason >= 0
            ? holdingReason
            : 0;
  }
  const firstReason = reasonLines[mainReason] ?? '자료 없음';
  const shortened = text(firstReason, reasonBudget);
  const reason = `• ${shortened}${shortened.length < firstReason.length ? '…' : ''}`;
  const requiredReasons = buy ? [`• ${setupLine(candidate, rules)}`, reason] : [reason];
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
  const historyRequired = history.length === 1 ? history : history.slice(0, 2);
  const historyOptional = history.length === 1 ? [] : history.slice(2);
  const sections: CandidateSection[] = [{ key: 'identity', required: identity, optional: [] }];
  if (buy) {
    sections.push({
      key: 'plan',
      heading: '매매 계획',
      required: [...tradePlanLines(candidate.dataAsOf), sizingLine(sizing), cohortLine()],
      optional: ['주문: 시가 매수·종가 매도 주문을 전날 미리 예약'],
    });
  }
  sections.push(
    {
      key: 'history',
      heading: '과거 BUY 순수익 관측',
      required: buy ? historyRequired : [...historyRequired, cohortLine()],
      optional: historyOptional,
    },
    {
      key: 'reference',
      heading: '검증 외 참고값 (통화 미제공)',
      required: referenceLines,
      optional: referenceOptional,
    },
    {
      key: 'targets',
      heading: '애널리스트 목표가',
      required: targetSummary.slice(0, targets?.consensus ? 2 : 1),
      optional: targetSummary
        .slice(targets?.consensus ? 2 : 1)
        .filter((line) => !sources.includes(line)),
    },
    {
      key: 'reasons',
      heading: '원판정 근거',
      required: requiredReasons,
      optional: reasonLines
        .filter((_, index) => index !== mainReason && index !== scoreReason)
        .map((line) => `• ${line}`),
    },
    { key: 'sources', heading: '출처', required: [], optional: sources }
  );
  return sections;
}

const OPTIONAL_PRIORITY: CandidateSection['key'][] = [
  'reference',
  'sources',
  'targets',
  'history',
  'reasons',
  'plan',
];
/** Sections whose required lines may be dropped (last first) when a block cannot fit. */
const TRIMMABLE: CandidateSection['key'][] = [
  'sources',
  'targets',
  'reference',
  'history',
  'reasons',
];

function tickerList(tickers: readonly string[], maximum = 12): string {
  const names = [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()))].filter(
    (ticker) => ticker.length <= 32 && TICKER.test(ticker)
  );
  const shown = names.slice(0, maximum);
  const remaining = names.length - shown.length;
  return `${shown.join(', ')}${remaining > 0 ? ` 외 ${remaining}` : ''}`;
}

function resolveSession(input: StockReportAlertInput): string | null {
  const explicit = isoDate(input.usSession);
  if (explicit) return explicit;
  const dates = input.candidates
    .map((candidate) => isoDate(candidate.dataAsOf))
    .filter((date): date is string => date !== null)
    .sort();
  return dates.at(-1) ?? latestCompletedSession();
}

function universeLabel(source: string | undefined): string {
  if (source === 'finviz-candidates') return ' · 검증 유니버스 외 (Finviz 후보)';
  if (source === 'configured-universe') return ' · 검증 유니버스';
  return '';
}

/** First lines of every message: the US session, then which tickers matched. */
function headerLines(input: StockReportAlertInput): string[] {
  const session = resolveSession(input);
  const lines = [
    session
      ? `미국 세션 ${session}(${usDay(session).slice(-2, -1)}) 종가 기준`
      : '미국 세션 자료 없음',
  ];
  const decision = input.screening?.decision;
  const matched = input.matchedTickers ?? [];
  if (matched.length) {
    const label = decision && decision !== 'ALL' ? decision : 'BUY';
    lines.push(
      `${label} ${matched.length}종목: ${tickerList(matched)}${universeLabel(input.universeSource)}`
    );
    return lines;
  }
  const groups = (['BUY', 'SELL', 'HOLD'] as const)
    .map((item) => ({
      item,
      tickers: input.candidates.filter((candidate) => candidate.decision === item),
    }))
    .filter((group) => group.tickers.length)
    .map(
      (group) =>
        `${group.item} ${group.tickers.length}종목: ${tickerList(group.tickers.map((candidate) => candidate.ticker))}`
    );
  if (groups.length) lines.push(`${groups.join(' · ')}${universeLabel(input.universeSource)}`);
  return lines;
}

/** Each ticker block keeps whole lines; no final price or URL is sliced mid-value. */
export function formatStockReportWhatsAppNotification(
  input: StockReportAlertInput,
  details: readonly StockReportAlertDetail[]
): WhatsAppNotification {
  const candidates = input.candidates.slice(0, MAX_DETAILS);
  const jobId = formatShortJobId(input.jobId);
  const header = headerLines(input);
  const outcome = input.screening ? formatScreeningOutcome(input.screening).split('\n') : [];
  const title = text(input.title, 80);
  const asOf = text(input.asOf, 60);
  if (!candidates.length) {
    // Heartbeat: session, outcome and job reference only; nothing to act on.
    const lines = [
      jobId ? `${header[0]} · 작업 ${jobId}` : header[0],
      ...(outcome.length ? outcome : ['상세 후보 없음.']),
    ];
    return { title, asOf, summary: lines.join('\n') };
  }
  const diagnostics = outcome.slice(1);
  const footerLines = [
    ...(diagnostics.length ? ['*분석 제외*', ...diagnostics] : []),
    ...(jobId ? [`작업 ${jobId}`] : []),
  ];
  const footer = footerLines.join('\n');
  const headerText = header.join('\n');
  const sizing = validSizing(input.sizing ?? resolvePositionSizing());
  const blocks: string[] = [];
  const budget = Math.floor(
    (MAX_SUMMARY_LENGTH -
      headerText.length -
      2 -
      (candidates.length - 1) * 2 -
      (footer ? footer.length + 2 : 0)) /
      candidates.length
  );
  for (const candidate of candidates) {
    const detail = details.find(
      (item) => item.ticker === candidate.ticker && item.lookbackDays === input.lookbackDays
    );
    const sections = candidateSections(
      candidate,
      detail,
      Math.min(140, Math.max(24, Math.floor(budget / 10))),
      input.pipelineConfig,
      sizing
    );
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
    const limit = budget - omission.length - 2;
    // Required lines rarely overflow; when they do, drop auxiliary sections last-line first.
    for (const key of TRIMMABLE) {
      const index = sections.findIndex((section) => section.key === key);
      while (render().length > limit && selected[index].length) {
        selected[index].pop();
        omitted = true;
      }
    }
    for (const key of OPTIONAL_PRIORITY) {
      const index = sections.findIndex((section) => section.key === key);
      if (index < 0) continue;
      for (const line of sections[index].optional) {
        selected[index].push(line);
        if (render().length > limit) {
          selected[index].pop();
          omitted = true;
        }
      }
    }
    blocks.push(`${render()}${omitted ? `\n${omission}` : ''}`);
  }
  return {
    title,
    asOf,
    summary: [headerText, ...blocks, ...(footer ? [footer] : [])].join('\n\n'),
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
