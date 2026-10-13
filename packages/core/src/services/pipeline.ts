import { MIN_ELIGIBLE_NOMINAL_PRICE } from '@/constants';
import { gradientScore } from '@/services/analysis';
import { confluenceCheck } from '@/services/confluence';
import { gaussianChannel } from '@/services/gaussian-channel';
import { calcInstitutionalScore } from '@/services/institutional';
import { reversalConfirm } from '@/services/reversal-confirm';
import { trendGate } from '@/services/trend-gate';
import type {
  BenchmarkCandle,
  CandleData,
  ClusterState,
  ConfluenceResult,
  IndicatorValues,
  PipelineConfig,
  PipelineResult,
  ReversalConfirmation,
  SignalCheck,
  SignalGateId,
  StrategyName,
  TrendGateResult,
} from '@/types';

const MS_PER_DAY = 86_400_000;

/** 'leader-pullback' is the readable alias of the shipped 'institutional' strategy. */
export function isLeaderPullbackStrategy(strategy: StrategyName): boolean {
  return strategy === 'institutional' || strategy === 'leader-pullback';
}

const HOLD_CONFLUENCE: ConfluenceResult = {
  passed: false,
  activeIndicators: 0,
  totalIndicators: 6,
  ratio: 0,
};
const HOLD_REVERSAL: ReversalConfirmation = { status: 'rejected', trigger: null };

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Quality-blocked bar that was already a pullback: below SMA50 with both RS clauses passing. */
export function isPullbackSetup(result: PipelineResult): boolean {
  if (!result.qualityBlocked || !result.checks) return false;
  const passed = (id: string) =>
    result.checks?.some((check) => check.gate === 'quality' && check.id === id && check.passed) ??
    false;
  return passed('below-sma50') && passed('rs-spy') && passed('rs-sector');
}

export function evaluateSignal(params: {
  ticker: string;
  indicators: IndicatorValues;
  close: number;
  open: number;
  fearGreed: number | null;
  patternScore: number;
  recentCandles: CandleData[];
  recentMacdHistogram: number[];
  config: PipelineConfig;
  /** Dates of consumed setups (BUYs and, by default, quality-blocked score-fires). */
  recentBuyDates?: Date[];
  currentDate?: Date;
  /**
   * Session indexes aligned with `recentBuyDates`, plus the current bar's index.
   * Required for `clusterFilter.gapUnit: 'sessions'`; without them the gap falls
   * back to calendar days.
   */
  recentBuySessionIndexes?: number[];
  currentSessionIndex?: number;
  allCloses?: number[];
  allDates?: Date[];
  allHighs?: number[];
  allLows?: number[];
  allVolumes?: number[];
  spyCandles?: BenchmarkCandle[];
  sectorCandles?: BenchmarkCandle[];
  /**
   * 20-session average nominal dollar volume. When supplied with an enabled
   * institutional section it is a hard eligibility floor
   * (`institutional.minAvgDailyDollarVol`); undefined = unknown, not checked.
   */
  avgDailyDollarVol?: number;
  /** Nominal (unadjusted) close for the price-floor eligibility check; undefined = not checked. */
  nominalClose?: number;
  earningsBeat?: boolean | null;
  earningsEstimateUp?: boolean | null;
  /**
   * Optional precomputed Gaussian Channel point for this bar. The Gaussian
   * filter is purely causal, so the point computed from the full series at index
   * i is identical to recomputing on closes[0..i]. Callers that evaluate many
   * bars (e.g. the backtest) can precompute the series once and pass the point
   * here to avoid the O(n²) per-bar recompute. When omitted, it is recomputed.
   */
  gaussianPoint?: { direction: 'up' | 'down' | 'flat'; isGreen: boolean };
  /**
   * Market-level trend regime (SPY Gaussian Channel green = true), consumed by
   * qualityGate.requireMarketUptrend. null/undefined = unknown — never blocks.
   */
  marketUptrend?: boolean | null;
}): PipelineResult {
  const {
    ticker,
    indicators,
    close,
    fearGreed,
    patternScore,
    recentCandles,
    recentMacdHistogram,
    config,
    recentBuyDates = [],
    currentDate,
    recentBuySessionIndexes,
    currentSessionIndex,
    allCloses = [],
    allDates,
    allHighs = [],
    allLows = [],
    allVolumes = [],
    spyCandles = [],
    sectorCandles = [],
    avgDailyDollarVol,
    nominalClose,
    earningsBeat = null,
    earningsEstimateUp = null,
    gaussianPoint,
    marketUptrend = null,
  } = params;
  const leaderPullback = isLeaderPullbackStrategy(config.strategy);
  const checks: SignalCheck[] = [];
  const check = (
    gate: SignalGateId,
    id: string,
    passed: boolean,
    value: SignalCheck['value'],
    limit: SignalCheck['limit'],
    comparator: SignalCheck['comparator']
  ): boolean => {
    checks.push({ gate, id, passed, value, limit, comparator });
    return passed;
  };

  // Gate 1: Trend filter (buy-side only)
  // When trendGate.source === 'gaussian' we derive regime from the Gaussian Channel;
  // otherwise we fall back to the classic SMA50/200 cross (existing behaviour).
  let trendResult: TrendGateResult;
  if (config.trendGate.source === 'gaussian' && allCloses.length >= 2) {
    // Reuse a precomputed point when supplied (identical result, no O(n) recompute).
    const gc = gaussianPoint ?? gaussianChannel(allCloses);
    const regime: TrendGateResult['regime'] =
      gc.direction === 'up' ? 'uptrend' : gc.direction === 'down' ? 'downtrend' : 'sideways';
    // The gate passes whenever the filter slope is >= 0 (rising or flat); only a
    // falling filter blocks. `strength` is a display mapping of the direction
    // (100/50/0), not a measure of slope magnitude, and the confidence gate that
    // reads it is disabled in the shipped configuration.
    trendResult = {
      passed: regime === 'uptrend' || regime === 'sideways',
      regime,
      strength: gc.direction === 'up' ? 100 : gc.direction === 'down' ? 0 : 50,
      reason: `Gaussian Channel: filter ${gc.direction}, isGreen=${gc.isGreen}`,
    };
    check('trend', 'filter-direction', trendResult.passed, gc.direction, 'up|flat', 'in');
  } else {
    trendResult = trendGate({
      close,
      sma50: indicators.sma50,
      sma200: indicators.sma200,
      config: config.trendGate,
    });
    if (config.trendGate.enabled) {
      check('trend', 'regime', trendResult.passed, trendResult.regime, 'uptrend|sideways', 'in');
    }
  }

  // Gate 2.5: Institutional score (always compute when enabled — needed by both strategies)
  const instResult = config.institutional.enabled
    ? calcInstitutionalScore({
        close,
        highs: allHighs.length > 0 ? allHighs : recentCandles.map((c) => c.high),
        lows: allLows.length > 0 ? allLows : recentCandles.map((c) => c.low),
        closes: allCloses.length > 0 ? allCloses : [close],
        tickerDates: allDates,
        volumes: allVolumes.length > 0 ? allVolumes : recentCandles.map((c) => c.volume),
        donchUpper: indicators.donchUpper,
        volumeRatio: indicators.volumeRatio,
        spyCandles,
        sectorCandles,
        avgDailyDollarVol: avgDailyDollarVol ?? 0,
        earningsBeat,
        earningsEstimateUp,
        config: config.institutional,
      })
    : {
        score: 1,
        passed: true,
        components: { rsSpy: 0, rsSector: 0, vwap: 0, breakoutVol: 0, liquidity: 0, earnings: 0 },
      };

  // Gate 2: Gradient scoring
  // For the leader-pullback ('institutional') strategy, pass the pre-computed flow
  // component gradients so institutionalGradientScore can use them as primary inputs.
  const { buyScore, sellScore, gradients } = gradientScore({
    indicators,
    close,
    fearGreed,
    patternScore,
    recentMacdHistogram,
    config,
    flowInputs: leaderPullback ? instResult.components : undefined,
  });

  const hold = (
    blockedBy: SignalGateId,
    gates: Partial<PipelineResult['gateResults']> = {},
    extra: Partial<PipelineResult> = {}
  ): PipelineResult => ({
    ticker,
    finalDecision: 'HOLD',
    score: Math.max(buyScore, sellScore),
    buyScore,
    sellScore,
    gateResults: {
      trend: trendResult,
      confluence: HOLD_CONFLUENCE,
      reversal: HOLD_REVERSAL,
      institutional: instResult,
      ...gates,
    },
    confidence: 0,
    blockedBy,
    checks,
    ...extra,
  });

  // Check BUY path
  const scoreFired = buyScore >= config.thresholds.buy && buyScore >= sellScore;
  check('score', 'buy-score', scoreFired, buyScore, config.thresholds.buy, '>=');
  if (scoreFired) {
    // Gate 1.1: Eligibility — the validated domain is liquid names at a real
    // price. Unknown inputs (undefined) are not checked; a supplied value is a
    // hard floor. These are domain preconditions, not setup judgments, so a
    // failure never consumes the cluster window.
    if (config.institutional.enabled) {
      const liquid =
        avgDailyDollarVol === undefined ||
        check(
          'eligibility',
          'avg-dollar-volume',
          avgDailyDollarVol >= config.institutional.minAvgDailyDollarVol,
          avgDailyDollarVol,
          config.institutional.minAvgDailyDollarVol,
          '>='
        );
      const priced =
        nominalClose === undefined ||
        check(
          'eligibility',
          'nominal-price',
          nominalClose >= MIN_ELIGIBLE_NOMINAL_PRICE,
          nominalClose,
          MIN_ELIGIBLE_NOMINAL_PRICE,
          '>='
        );
      if (!liquid || !priced) return hold('eligibility');
    }

    // Trend gate blocks buys in downtrends
    if (!trendResult.passed) return hold('trend');

    // Gate 1.5: Regime filter
    if (config.regimeFilter.enabled) {
      if (config.strategy === 'momentum') {
        // Momentum: only accumulate in uptrends — block downtrend entries
        if (
          !check(
            'regime',
            'not-downtrend',
            trendResult.regime !== 'downtrend',
            trendResult.regime,
            'downtrend',
            '=='
          )
        ) {
          return hold('regime');
        }
      } else if (config.regimeFilter.blockUptrend) {
        // Mean-reversion: avoid buying extended uptrends
        if (
          !check(
            'regime',
            'not-uptrend',
            trendResult.regime !== 'uptrend',
            trendResult.regime,
            'uptrend',
            '=='
          )
        ) {
          return hold('regime');
        }
      }
    }

    // Gate 1.6: Cluster filter — skip if the same ticker consumed a setup recently
    if (config.clusterFilter.enabled && currentDate && recentBuyDates.length > 0) {
      const minGap = config.clusterFilter.minGapDays;
      const gapUnit = config.clusterFilter.gapUnit ?? 'calendar';
      const useSessions =
        gapUnit === 'sessions' &&
        currentSessionIndex !== undefined &&
        recentBuySessionIndexes !== undefined &&
        recentBuySessionIndexes.length === recentBuyDates.length;
      let lastIndex = -1;
      let latestGap = Number.POSITIVE_INFINITY;
      let tooRecent = false;
      for (let k = 0; k < recentBuyDates.length; k++) {
        let gap: number;
        if (useSessions) {
          gap = (currentSessionIndex as number) - (recentBuySessionIndexes as number[])[k];
          if (gap < minGap) tooRecent = true;
        } else {
          // Validated arithmetic: compare in milliseconds, report in days.
          const gapMs = currentDate.getTime() - recentBuyDates[k].getTime();
          if (gapMs < minGap * MS_PER_DAY) tooRecent = true;
          gap = gapMs / MS_PER_DAY;
        }
        if (gap < latestGap) {
          latestGap = gap;
          lastIndex = k;
        }
      }
      check('cluster', 'min-gap', !tooRecent, latestGap, minGap, '>=');
      if (tooRecent) {
        const lastSetup = recentBuyDates[lastIndex];
        let nextEligibleDate: string | null = null;
        if (useSessions) {
          const eligibleIndex = (recentBuySessionIndexes as number[])[lastIndex] + minGap;
          const eligible = allDates?.[eligibleIndex];
          nextEligibleDate = eligible ? isoDate(eligible) : null;
        } else {
          nextEligibleDate = isoDate(new Date(lastSetup.getTime() + minGap * MS_PER_DAY));
        }
        const cluster: ClusterState = {
          lastSetupDate: isoDate(lastSetup),
          nextEligibleDate,
          gapUnit: useSessions ? 'sessions' : 'calendar',
          minGap,
        };
        return hold('cluster', {}, { cluster });
      }
    }

    // Gate 1.7: Entry-quality (pullback) gate — essay-aligned. Require a calm
    // intraday pullback with steady, non-blowoff participation before buying:
    // low IBS (closed near the low), low ATR% (calm name), moderate volume.
    if (config.qualityGate?.enabled) {
      const q = config.qualityGate;
      const bar = recentCandles[recentCandles.length - 1];
      const range = bar ? bar.high - bar.low : 0;
      const ibs = range > 0 ? (close - bar.low) / range : 0.5;
      const atrPct = close > 0 ? (indicators.atr / close) * 100 : 0;
      const volR = indicators.volumeRatio;
      const rs = instResult.components;
      // Every clause is evaluated (not short-circuited) so the checks list shows
      // each observed value; the decision is the conjunction, as before.
      const clauses = [
        check('quality', 'ibs', ibs < q.ibsMax, ibs, q.ibsMax, '<'),
        check('quality', 'atr-pct', atrPct < q.atrPctMax, atrPct, q.atrPctMax, '<'),
        check('quality', 'vol-ratio-min', volR > q.volRMin, volR, q.volRMin, '>'),
        check('quality', 'vol-ratio-max', volR < q.volRMax, volR, q.volRMax, '<'),
        q.scoreMax === undefined ||
          check('quality', 'score-max', buyScore < q.scoreMax, buyScore, q.scoreMax, '<'),
        q.rsMin === undefined ||
          check('quality', 'rs-spy', rs.rsSpy >= q.rsMin, rs.rsSpy, q.rsMin, '>='),
        q.rsMin === undefined ||
          check('quality', 'rs-sector', rs.rsSector >= q.rsMin, rs.rsSector, q.rsMin, '>='),
        !q.requireBelowSma50 ||
          check('quality', 'below-sma50', close < indicators.sma50, close, indicators.sma50, '<'),
        !q.requireAboveSma200 ||
          Number.isNaN(indicators.sma200) ||
          check(
            'quality',
            'above-sma200',
            close > indicators.sma200,
            close,
            indicators.sma200,
            '>'
          ),
        q.vwapMin === undefined ||
          check('quality', 'vwap', rs.vwap >= q.vwapMin, rs.vwap, q.vwapMin, '>='),
        // Market kill-switch: block only when the market regime is explicitly
        // known to be down — callers without SPY data are never blocked.
        !q.requireMarketUptrend ||
          check('quality', 'market-uptrend', marketUptrend !== false, marketUptrend, true, '=='),
      ];
      if (!clauses.every(Boolean)) {
        // Setup consumed: the score fired and the quality judgment is made once.
        // Callers should record this date in their cluster window so the same
        // deteriorating cluster cannot re-trigger on later (worse) bars.
        return hold('quality', {}, { qualityBlocked: true });
      }
    }

    // Gate 2.5: Institutional score gate
    // For the leader-pullback strategy the score is already BLENDED into buyScore
    // via institutionalGradientScore — do NOT hard-gate here, allow the signal through.
    // For legacy strategies (momentum/mean-reversion) keep the original hard-gate.
    if (
      !leaderPullback &&
      config.institutional.enabled &&
      !check(
        'institutional',
        'flow-score',
        instResult.passed,
        instResult.score,
        config.institutional.threshold,
        '>='
      )
    ) {
      return hold('institutional');
    }

    // Gate 3: Confluence check
    const confluenceResult = confluenceCheck({ gradients, config: config.confluence });
    check(
      'confluence',
      'active-indicators',
      confluenceResult.passed,
      confluenceResult.activeIndicators,
      config.confluence.minActive,
      '>='
    );
    if (!confluenceResult.passed) return hold('confluence', { confluence: confluenceResult });

    // Gate 4: Reversal confirmation (adds no check when disabled)
    const reversalResult = reversalConfirm({
      recentCandles,
      volumeRatio: indicators.volumeRatio,
      config: config.reversalConfirm,
    });
    if (config.reversalConfirm.enabled) {
      check(
        'reversal',
        'status',
        reversalResult.status === 'confirmed',
        reversalResult.status,
        'confirmed',
        '=='
      );
    }
    if (reversalResult.status === 'rejected') {
      return hold('reversal', { confluence: confluenceResult, reversal: reversalResult });
    }

    // Gate 5: Ensemble confidence
    const trendNorm = trendResult.strength / 100;
    const scoreNorm = Math.min((buyScore - config.thresholds.buy) / config.thresholds.buy, 1);
    const confNorm = confluenceResult.ratio;
    const revNorm =
      reversalResult.trigger === 'both'
        ? 1.0
        : reversalResult.trigger === 'bullish_candle'
          ? 0.5
          : 0;

    const cg = config.confidenceGate;
    const ensembleConfidence =
      (cg.weights.trend * trendNorm +
        cg.weights.score * scoreNorm +
        cg.weights.confluence * confNorm +
        cg.weights.reversal * revNorm) *
      100;

    if (
      cg.enabled &&
      !check(
        'confidence',
        'ensemble',
        ensembleConfidence >= cg.threshold,
        ensembleConfidence,
        cg.threshold,
        '>='
      )
    ) {
      return hold('confidence', { confluence: confluenceResult, reversal: reversalResult });
    }

    return {
      ticker,
      finalDecision: 'BUY',
      score: buyScore,
      buyScore,
      sellScore,
      gateResults: {
        trend: trendResult,
        confluence: confluenceResult,
        reversal: reversalResult,
        institutional: instResult,
      },
      confidence: ensembleConfidence,
      checks,
    };
  }

  // Check SELL path (no trend gate or reversal confirmation needed).
  //
  // For the leader-pullback strategy, SELL is an EXIT discipline, not a downside
  // prediction: backtest showed distribution-day SELLs have NEGATIVE directional
  // edge (41.9% 5-day accuracy vs 47.6% base down-rate — panic days mean-revert),
  // and essay #1 treats distribution as a holder's exit warning, not a short
  // signal. So SELL only fires when the trend itself is broken (regime =
  // downtrend, essay #2's exit rule) AND distribution is confirmed by sellScore.
  // Selling leaders inside an intact uptrend is exactly the mistake the essays
  // warn against — those SELLs are suppressed to HOLD.
  const sellFired = sellScore >= config.thresholds.sell && sellScore > buyScore;
  if (sellFired) {
    const sellRegimeOk = !leaderPullback || trendResult.regime === 'downtrend';
    if (leaderPullback) {
      check('sell-regime', 'regime', sellRegimeOk, trendResult.regime, 'downtrend', '==');
    }
    if (sellRegimeOk) {
      return {
        ticker,
        finalDecision: 'SELL',
        score: sellScore,
        buyScore,
        sellScore,
        gateResults: {
          trend: trendResult,
          confluence: HOLD_CONFLUENCE,
          reversal: HOLD_REVERSAL,
          institutional: instResult,
        },
        confidence: 0,
        checks,
      };
    }
    return hold('sell-regime');
  }

  // HOLD: neither score fired
  return hold('score');
}
