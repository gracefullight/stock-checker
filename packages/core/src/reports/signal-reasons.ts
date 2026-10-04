import type { TickerAnalysisContext } from '@/services/ticker-analysis';

export function gateReasons(context: TickerAnalysisContext): string[] {
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
