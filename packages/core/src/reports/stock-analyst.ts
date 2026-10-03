import { buildTickerContext, runSignalsWithContext } from '@/optimization/engine';
import {
  type HistoricalOutcomesReport,
  summarizeHistoricalOutcomes,
} from '@/reports/historical-outcomes';
import { type AnalystTargetsReport, getAnalystTargets } from '@/services/analyst-targets';
import type { LongRiskLevels } from '@/services/risk-levels';
import { analyzeTickerContext, type TickerAnalysisContext } from '@/services/ticker-analysis';
import { getValuation, type ValuationReport } from '@/services/valuation';
import type { PipelineResult } from '@/types';

export interface StockAnalystReport {
  schemaVersion: 1;
  ticker: string;
  status: 'available' | 'unavailable';
  generatedAt: string;
  /** Last completed exchange session date; not an intraday quote timestamp. */
  dataAsOf: string | null;
  lookbackDays: number;
  current: {
    decision: PipelineResult['finalDecision'];
    buyScore: number;
    sellScore: number;
    gates: PipelineResult['gateResults'];
    gateReasons: string[];
    scoreWeights: {
      buy: number | null;
      sell: number | null;
      hold: number | null;
      meaning: 'normalized signal scores, not probabilities of profit';
    };
  } | null;
  execution: {
    entry: {
      status: 'conditional';
      timing: 'next-session-open';
      price: null;
      eligible: boolean;
    };
    reference:
      | (LongRiskLevels & {
          basis: 'latest-completed-close';
          price: number;
          atr: number;
        })
      | null;
  };
  historical: HistoricalOutcomesReport;
  analystTargets: AnalystTargetsReport;
  valuation: ValuationReport | null;
  warnings: string[];
}

function gateReasons(context: TickerAnalysisContext): string[] {
  const { pipelineResult: signal, config } = context;
  const gates = signal.gateResults;
  const reasons = [
    `BUY trend gate: ${gates.trend.reason}; ${gates.trend.passed ? 'passed' : 'blocked'}.`,
    `BUY score ${signal.buyScore.toFixed(2)} / threshold ${config.thresholds.buy}; SELL score ${signal.sellScore.toFixed(2)} / threshold ${config.thresholds.sell}.`,
    `Confluence: ${gates.confluence.activeIndicators}/${gates.confluence.totalIndicators}; ${gates.confluence.passed ? 'passed' : 'not passed or not evaluated'}.`,
    `Reversal: ${gates.reversal.status}; trigger ${gates.reversal.trigger ?? 'none / not evaluated'}.`,
    `Institutional score ${gates.institutional.score.toFixed(3)}; ${gates.institutional.passed ? 'passed' : 'below threshold'}. The institutional strategy blends this score into BUY scoring.`,
  ];
  if (signal.qualityBlocked) {
    reasons.push('The entry-quality gate rejected this score-qualified BUY setup.');
  }
  if (signal.finalDecision === 'HOLD') {
    reasons.push(
      'No entry: the complete BUY path did not pass or neither eligible decision qualified.'
    );
  } else if (signal.finalDecision === 'SELL') {
    reasons.push('SELL is a long-holder exit warning, not a short-entry recommendation.');
  } else {
    reasons.push(
      'BUY qualifies at the completed close; execution remains conditional on the next session open.'
    );
  }
  return reasons;
}

const percentage = (value: number | null): string =>
  value === null ? 'N/A' : `${value.toFixed(2)}%`;
const price = (value: number | null): string => (value === null ? 'N/A' : value.toFixed(2));
const escapeMarkdown = (value: string): string => value.replace(/[\\`*_{}[\]()#+.!|<>-]/g, '\\$&');

export function renderStockAnalystMarkdown(report: StockAnalystReport): string {
  const { current, execution, historical, analystTargets, valuation } = report;
  const lines = [
    `# ${report.ticker} stock analyst report`,
    '',
    `Generated: ${report.generatedAt}. Completed price session: ${report.dataAsOf ?? 'unavailable'}.`,
    `Judgment: ${current?.decision ?? 'unavailable'}.`,
    '',
    '## Current signal and execution',
    '',
    ...(current?.gateReasons.map((reason) => `- ${reason}`) ?? [
      '- No usable completed-price / ATR analysis is available.',
    ]),
    '- Entry: CONDITIONAL next-session open; the future entry price is unknown.',
    `- Entry eligibility: ${execution.entry.eligible ? 'BUY currently qualifies' : 'no qualifying BUY entry'}.`,
  ];
  if (execution.reference) {
    const reference = execution.reference;
    lines.push(
      `- ATR references use the latest completed close ${price(reference.price)}, ATR ${price(reference.atr)}: stop ${price(reference.stopLoss)}, target ${price(reference.takeProfit)}.`,
      '- These are latest-close reference prices. Recompute levels from the actual next-session fill; they are not known future execution prices.'
    );
  }
  if (current) {
    lines.push(
      `- Normalized score weights: BUY ${percentage(current.scoreWeights.buy)}, SELL ${percentage(current.scoreWeights.sell)}, HOLD ${percentage(current.scoreWeights.hold)}. These are not profit probabilities.`
    );
  }
  lines.push(
    '',
    '## Historical outcomes',
    '',
    `Eligible entry period: ${historical.period.from ?? 'N/A'} to ${historical.period.to ?? 'N/A'}; ${report.lookbackDays} calendar days requested, indicator warmup excluded.`,
    `Method: BUY at next-session open, exit at the fifth session close; ${historical.method.roundTripCostBps} bps total round-trip cost. Samples are completed BUY observations and may overlap; this is not a one-position portfolio simulation.`,
    `- Five-session net win rate: ${percentage(historical.fixedHold.winRatePct)} (${historical.fixedHold.wins}/${historical.fixedHold.samples}); average net return ${percentage(historical.fixedHold.averageNetReturnPct)}.`,
    `- ATR stop touched: ${percentage(historical.atrBarriers.stopTouchRatePct)} (${historical.atrBarriers.stopTouched}/${historical.atrBarriers.samples}); target touched: ${percentage(historical.atrBarriers.targetTouchRatePct)} (${historical.atrBarriers.targetTouched}/${historical.atrBarriers.samples}).`,
    `- Both barriers touched: ${historical.atrBarriers.bothTouched}; ambiguous first touch within one session: ${historical.atrBarriers.ambiguousFirstTouch}.`,
    `- First touches: stop ${historical.atrBarriers.stopFirst}, target ${historical.atrBarriers.targetFirst}, neither ${historical.atrBarriers.neitherTouched}; opening-gap first touches: stop ${historical.atrBarriers.gapStopFirst}, target ${historical.atrBarriers.gapTargetFirst}.`,
    '- ATR barriers use each signal-session ATR and its actual next-session open. Touch rates include the entire five-session path, even after a first hit; they are separate diagnostics, not net win rates. Opens determine gap fills before intraday touches; unknown same-bar high/low order is left ambiguous.',
    `- Excluded: incomplete horizons ${historical.excluded.incomplete}, invalid execution ${historical.excluded.invalidExecution}, unusable ATR / OHLC for barrier diagnostics ${historical.excluded.invalidAtrOrCandles}.`,
    '',
    '## Analyst price targets',
    ''
  );
  const consensus = analystTargets.consensus;
  if (consensus) {
    lines.push(
      `Consensus source: [${consensus.source}](${consensus.sourceUrl}); retrieved ${consensus.retrievedAt}.`,
      `Mean ${price(consensus.mean)}, median ${price(consensus.median)}, range ${price(consensus.low)}–${price(consensus.high)}, analysts ${consensus.analystCount ?? 'N/A'}, currency ${consensus.currency ?? 'N/A'}.`,
      `Mean upside ${percentage(consensus.meanUpsidePercent)} uses the target provider's current price ${price(consensus.currentPrice)}; its publication date and horizon are unavailable.`
    );
  } else {
    lines.push('Consensus target prices are unavailable.');
  }
  const recent = analystTargets.recent;
  lines.push(
    `Recent target updates: ${recent.status}; ${recent.updates.length} observed in ${recent.windowDays} days, ${recent.count30Days} in 30 days.${recent.reason ? ` ${recent.reason}` : ''}`
  );
  for (const update of recent.updates) {
    lines.push(
      `- ${update.publishedAt}: ${escapeMarkdown(update.firm)}, target ${price(update.targetPrice)}, prior target ${price(update.priorTargetPrice)}, currency ${update.currency ?? 'unknown / unprovided'}, source ${update.source}${update.sourceUrl ? ` (${update.sourceUrl})` : ''}.`
    );
  }
  lines.push('', '## Valuation', '');
  if (valuation) {
    const { company, industryComparison: industry, relative } = valuation;
    lines.push(
      `Source: [Yahoo Finance](${company.sourceUrl}); retrieved ${valuation.retrievedAt}; quote timestamp ${company.priceAsOf ?? 'unavailable'}.`,
      `Sector: ${escapeMarkdown(company.sector ?? 'unavailable')}; industry: ${escapeMarkdown(company.industry ?? 'unavailable')}.`,
      '',
      '| Metric | Stock | Same-industry peer median | Valid peers | Relative premium |',
      '|---|---:|---:|---:|---:|',
      `| TTM PER | ${price(company.trailingPE)} | ${price(industry.medianPE)} | ${industry.peSamples} | ${percentage(relative.pePremiumPct)} |`,
      `| TTM PSR | ${price(company.psr)} | ${price(industry.medianPSR)} | ${industry.psrSamples} | ${percentage(relative.psrPremiumPct)} |`,
      '',
      `Forward PER: ${price(company.forwardPE)}; it is separate from the TTM comparison.`,
      `Peer comparison: ${industry.status}; ${escapeMarkdown(industry.method)}.`,
      `Universe: ${escapeMarkdown(industry.universe)}.`,
      `Compared tickers: ${industry.peers.map((peer) => peer.ticker).join(', ') || 'none'}.`,
      `Coverage: ${industry.coverage.matchingIndustryCount} matching peers from ${industry.coverage.requestedCount} requested; ${industry.coverage.failedRequests} failed, ${industry.coverage.excludedIndustryCount} industry mismatches, ${industry.coverage.excludedNonEquityCount} non-equities excluded.`,
      ...(industry.sourceUrl ? [`Peer source: ${industry.sourceUrl}.`] : []),
      ...(company.peReason ? [`PER availability: ${escapeMarkdown(company.peReason)}`] : []),
      ...(company.psrReason ? [`PSR availability: ${escapeMarkdown(company.psrReason)}`] : []),
      ...(industry.reason ? [`Comparison availability: ${escapeMarkdown(industry.reason)}`] : [])
    );
  } else {
    lines.push('Valuation data is unavailable.');
  }
  lines.push('', '## Limitations', '', ...report.warnings.map((warning) => `- ${warning}`));
  return lines.join('\n');
}

export async function generateStockAnalystReport(
  ticker: string,
  options: { lookbackDays?: number } = {}
): Promise<{ report: StockAnalystReport; markdown: string }> {
  const symbol = ticker.trim().toUpperCase();
  if (
    symbol.length < 1 ||
    symbol.length > 32 ||
    !/^\^?[A-Z0-9]+(?:[.-][A-Z0-9]+)*(?:=[A-Z0-9]+)?$/.test(symbol)
  ) {
    throw new TypeError('ticker must be a single valid market symbol');
  }
  const lookbackDays = options.lookbackDays ?? 2920;
  if (!Number.isInteger(lookbackDays) || lookbackDays < 730 || lookbackDays > 3650) {
    throw new TypeError('lookbackDays must be an integer from 730 to 3650');
  }
  const [context, analystTargets, valuation] = await Promise.all([
    analyzeTickerContext(symbol, null, { lookbackDays }),
    getAnalystTargets(symbol),
    getValuation(symbol).catch(() => null),
  ]);
  const ctx = context
    ? buildTickerContext(context.dailyPrices, context.spyCandles, context.sectorCandles)
    : null;
  const signals = ctx && context ? runSignalsWithContext(ctx, symbol, context.config) : [];
  const historical = summarizeHistoricalOutcomes(
    symbol,
    ctx?.data ?? [],
    signals,
    ctx ? { start: ctx.evaluationStart } : {}
  );
  const result = context?.result;
  const report: StockAnalystReport = {
    schemaVersion: 1,
    ticker: symbol,
    status: context ? 'available' : 'unavailable',
    generatedAt: new Date().toISOString(),
    dataAsOf: result?.date ?? null,
    lookbackDays,
    current: context
      ? {
          decision: context.pipelineResult.finalDecision,
          buyScore: context.pipelineResult.buyScore,
          sellScore: context.pipelineResult.sellScore,
          gates: context.pipelineResult.gateResults,
          gateReasons: gateReasons(context),
          scoreWeights: {
            buy: result?.buyProbability ?? null,
            sell: result?.sellProbability ?? null,
            hold: result?.holdProbability ?? null,
            meaning: 'normalized signal scores, not probabilities of profit',
          },
        }
      : null,
    execution: {
      entry: {
        status: 'conditional',
        timing: 'next-session-open',
        price: null,
        eligible: context?.pipelineResult.finalDecision === 'BUY',
      },
      reference: result
        ? {
            basis: 'latest-completed-close',
            price: result.close,
            atr: result.atr,
            stopLoss: result.stopLoss,
            takeProfit: result.takeProfit,
            trailingStop: result.trailingStop,
            trailingStart: result.trailingStart,
          }
        : null,
    },
    historical,
    analystTargets,
    valuation,
    warnings: [
      'Historical frequencies are descriptive observations, not calibrated probabilities or independently validated future performance.',
      'Historical sector selection uses current ticker/sector metadata and the surviving requested symbol; point-in-time metadata and delisted-stock coverage are unavailable, creating metadata and survivorship bias.',
      'Current earnings metadata is fetched now; the historical engine omits unavailable point-in-time earnings. Current stateless snapshots do not apply the historical cluster suppression state, so historical and live inputs differ.',
      'Daily OHLC does not reveal intrabar order. Ambiguous first stop/target touches are not assigned an invented winning order.',
      'The fixed round-trip cost is a simplifying assumption; spread, market impact, partial fills and changing liquidity are not modeled.',
      ...(historical.fixedHold.samples > 0 && historical.fixedHold.samples < 30
        ? [
            `Only ${historical.fixedHold.samples} completed BUY observations are available; this small sample cannot establish stable outcome probabilities.`,
          ]
        : []),
      ...(!ctx
        ? [
            'Historical analysis requires at least 210 completed sessions; no historical success rate is reported without completed BUY samples.',
          ]
        : []),
      ...analystTargets.warnings,
      ...(valuation?.warnings ?? [
        'Valuation data could not be retrieved; the technical signal and historical outcomes remain available independently.',
      ]),
    ],
  };
  return { report, markdown: renderStockAnalystMarkdown(report) };
}
