import type { TickerAnalysisContext } from '@/services/ticker-analysis';
import type { SignalCheck, SignalGateId } from '@/types';

const GATE_LABELS: Record<SignalGateId, string> = {
  score: 'BUY score below threshold',
  eligibility: 'eligibility floor (liquidity or nominal price)',
  trend: 'trend gate (Gaussian filter falling)',
  regime: 'regime filter',
  cluster: 'cluster filter (an earlier setup already consumed this window)',
  quality: 'entry-quality gate',
  institutional: 'institutional flow gate',
  confluence: 'momentum confluence gate',
  reversal: 'reversal confirmation gate',
  confidence: 'ensemble confidence gate',
  'sell-regime': 'SELL regime gate (trend not broken)',
  'insufficient-history': 'insufficient history (fewer than 210 sessions; unvalidated path)',
};

const CHECK_LABELS: Record<string, string> = {
  'buy-score': 'BUY score',
  'avg-dollar-volume': 'avg daily dollar volume',
  'nominal-price': 'nominal price',
  'filter-direction': 'Gaussian filter',
  regime: 'trend regime',
  'not-downtrend': 'regime',
  'not-uptrend': 'regime',
  'min-gap': 'gap since last setup',
  ibs: 'IBS',
  'atr-pct': 'ATR%',
  'vol-ratio-min': 'volume ratio',
  'vol-ratio-max': 'volume ratio',
  'score-max': 'BUY score cap',
  'rs-spy': 'RS vs SPY',
  'rs-sector': 'RS vs sector',
  'below-sma50': 'close vs SMA50',
  'above-sma200': 'close vs SMA200',
  vwap: 'VWAP gradient',
  'market-uptrend': 'SPY Gaussian green',
  'flow-score': 'institutional score',
  'active-indicators': 'active oscillators',
  status: 'reversal',
  ensemble: 'ensemble confidence',
  sessions: 'sessions of history',
};

function formatValue(value: SignalCheck['value']): string {
  if (value === null || value === undefined) return 'n/a';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'n/a';
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(Math.abs(value) >= 100 ? 1 : 2);
  }
  return String(value);
}

function describeCheck(check: SignalCheck): string {
  const label = CHECK_LABELS[check.id] ?? check.id;
  const unit = check.gate === 'cluster' ? ' days' : '';
  return `${label} ${formatValue(check.value)}${unit} ${check.comparator} ${formatValue(check.limit)}${unit} (${check.passed ? 'ok' : 'failed'})`;
}

/**
 * Human-readable gate trail. The first line states the decision and, for a
 * HOLD, the gate that blocked it; later lines list only the clauses that were
 * actually evaluated (disabled gates add nothing). The three legacy
 * trend/score/institutional lines keep their exact wording because alert
 * renderers parse them.
 */
export function gateReasons(context: TickerAnalysisContext): string[] {
  const { pipelineResult: signal, config } = context;
  const gates = signal.gateResults;
  const checks = signal.checks ?? [];
  const reasons: string[] = [];

  if (signal.finalDecision === 'BUY') {
    reasons.push(
      'BUY qualifies at the completed close; execution remains conditional on the next session open.'
    );
  } else if (signal.finalDecision === 'SELL') {
    reasons.push('SELL is a long-holder exit warning, not a short-entry recommendation.');
  } else {
    const blocker = signal.blockedBy ? GATE_LABELS[signal.blockedBy] : 'no eligible decision';
    const failed = checks.filter((check) => check.gate === signal.blockedBy && !check.passed);
    const detail =
      signal.blockedBy === 'cluster' && signal.cluster
        ? `; last setup ${signal.cluster.lastSetupDate}, next eligible ${signal.cluster.nextEligibleDate ?? 'unknown'} (${signal.cluster.minGap} ${signal.cluster.gapUnit === 'sessions' ? 'sessions' : 'calendar days'})`
        : failed.length > 0
          ? `; ${failed.map(describeCheck).join('; ')}`
          : '';
    reasons.push(`HOLD: blocked by ${blocker}${detail}.`);
  }

  reasons.push(
    `BUY trend gate: ${gates.trend.reason}; ${gates.trend.passed ? 'passed' : 'blocked'}.`,
    `BUY score ${signal.buyScore.toFixed(2)} / threshold ${config.thresholds.buy}; SELL score ${signal.sellScore.toFixed(2)} / threshold ${config.thresholds.sell}.`
  );
  if (config.institutional.enabled) {
    reasons.push(
      `Institutional score ${gates.institutional.score.toFixed(3)}; ${gates.institutional.passed ? 'passed' : 'below threshold'}. The institutional strategy blends this score into BUY scoring.`
    );
  }
  if (signal.qualityBlocked) {
    reasons.push('The entry-quality gate rejected this score-qualified BUY setup.');
  }
  for (const gate of [
    'eligibility',
    'cluster',
    'quality',
    'confluence',
    'reversal',
    'confidence',
  ] as const) {
    const evaluated = checks.filter((check) => check.gate === gate);
    if (evaluated.length === 0) continue;
    const label =
      gate === 'quality'
        ? 'Entry quality'
        : gate === 'confluence'
          ? 'Confluence'
          : gate === 'reversal'
            ? 'Reversal'
            : gate === 'confidence'
              ? 'Confidence'
              : gate === 'cluster'
                ? 'Cluster'
                : 'Eligibility';
    reasons.push(`${label}: ${evaluated.map(describeCheck).join('; ')}.`);
  }
  return reasons;
}
