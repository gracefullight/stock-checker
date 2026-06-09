import { gradientScore } from '@/services/analysis';
import { confluenceCheck } from '@/services/confluence';
import type { BenchmarkCandle } from '@/services/data-fetcher';
import { gaussianChannel } from '@/services/gaussian-channel';
import { calcInstitutionalScore } from '@/services/institutional';
import { reversalConfirm } from '@/services/reversal-confirm';
import { trendGate } from '@/services/trend-gate';
import type {
  CandleData,
  ConfluenceResult,
  IndicatorValues,
  InstitutionalScore,
  PipelineConfig,
  PipelineResult,
  ReversalConfirmation,
  TrendGateResult,
} from '@/types';

const _HOLD_TREND: TrendGateResult = {
  passed: false,
  regime: 'unknown',
  strength: 0,
  reason: 'not evaluated',
};
const HOLD_CONFLUENCE: ConfluenceResult = {
  passed: false,
  activeIndicators: 0,
  totalIndicators: 6,
  ratio: 0,
};
const HOLD_REVERSAL: ReversalConfirmation = { status: 'rejected', trigger: null };
const HOLD_INSTITUTIONAL: InstitutionalScore = {
  score: 0,
  passed: false,
  components: { rsSpy: 0, rsSector: 0, vwap: 0, breakoutVol: 0, liquidity: 0, earnings: 0 },
};

function makeHold(
  ticker: string,
  buyScore: number,
  sellScore: number,
  trend: TrendGateResult,
  confluence: ConfluenceResult,
  reversal: ReversalConfirmation,
  institutional: InstitutionalScore = HOLD_INSTITUTIONAL
): PipelineResult {
  return {
    ticker,
    finalDecision: 'HOLD',
    score: Math.max(buyScore, sellScore),
    buyScore,
    sellScore,
    gateResults: { trend, confluence, reversal, institutional },
    confidence: 0,
  };
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
  recentBuyDates?: Date[];
  currentDate?: Date;
  allCloses?: number[];
  allHighs?: number[];
  allLows?: number[];
  allVolumes?: number[];
  spyCandles?: BenchmarkCandle[];
  sectorCandles?: BenchmarkCandle[];
  avgDailyDollarVol?: number;
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
    allCloses = [],
    allHighs = [],
    allLows = [],
    allVolumes = [],
    spyCandles = [],
    sectorCandles = [],
    avgDailyDollarVol = 0,
    earningsBeat = null,
    earningsEstimateUp = null,
    gaussianPoint,
  } = params;

  // Gate 1: Trend filter (buy-side only)
  // When trendGate.source === 'gaussian' we derive regime from the Gaussian Channel;
  // otherwise we fall back to the classic SMA50/200 cross (existing behaviour).
  let trendResult: TrendGateResult;
  if (config.trendGate.source === 'gaussian' && allCloses.length >= 2) {
    // Reuse a precomputed point when supplied (identical result, no O(n) recompute).
    const gc = gaussianPoint ?? gaussianChannel(allCloses);
    const regime: TrendGateResult['regime'] =
      gc.direction === 'up' ? 'uptrend' : gc.direction === 'down' ? 'downtrend' : 'sideways';
    trendResult = {
      passed: regime === 'uptrend' || regime === 'sideways',
      regime,
      strength: gc.direction === 'up' ? 100 : gc.direction === 'down' ? 0 : 50,
      reason: `Gaussian Channel: filter ${gc.direction}, isGreen=${gc.isGreen}`,
    };
  } else {
    trendResult = trendGate({
      close,
      sma50: indicators.sma50,
      sma200: indicators.sma200,
      config: config.trendGate,
    });
  }

  // Gate 2.5: Institutional score (always compute when enabled — needed by both strategies)
  const instResult = config.institutional.enabled
    ? calcInstitutionalScore({
        close,
        highs: allHighs.length > 0 ? allHighs : recentCandles.map((c) => c.high),
        lows: allLows.length > 0 ? allLows : recentCandles.map((c) => c.low),
        closes: allCloses.length > 0 ? allCloses : [close],
        volumes: allVolumes.length > 0 ? allVolumes : recentCandles.map((c) => c.volume),
        donchUpper: indicators.donchUpper,
        volumeRatio: indicators.volumeRatio,
        spyCandles,
        sectorCandles,
        avgDailyDollarVol,
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
  // For 'institutional' strategy, pass the pre-computed flow component gradients so
  // institutionalGradientScore can use them as primary (flow-dominant) inputs.
  const { buyScore, sellScore, gradients } = gradientScore({
    indicators,
    close,
    fearGreed,
    patternScore,
    recentMacdHistogram,
    config,
    flowInputs: config.strategy === 'institutional' ? instResult.components : undefined,
  });

  // Check BUY path
  if (buyScore >= config.thresholds.buy && buyScore >= sellScore) {
    // Trend gate blocks buys in downtrends
    if (!trendResult.passed) {
      return makeHold(
        ticker,
        buyScore,
        sellScore,
        trendResult,
        HOLD_CONFLUENCE,
        HOLD_REVERSAL,
        instResult
      );
    }

    // Gate 1.5: Regime filter
    if (config.regimeFilter.enabled) {
      if (config.strategy === 'momentum' && trendResult.regime === 'downtrend') {
        // Momentum: only accumulate in uptrends — block downtrend entries
        return makeHold(
          ticker,
          buyScore,
          sellScore,
          trendResult,
          HOLD_CONFLUENCE,
          HOLD_REVERSAL,
          instResult
        );
      } else if (
        config.strategy !== 'momentum' &&
        config.regimeFilter.blockUptrend &&
        trendResult.regime === 'uptrend'
      ) {
        // Mean-reversion: avoid buying extended uptrends
        return makeHold(
          ticker,
          buyScore,
          sellScore,
          trendResult,
          HOLD_CONFLUENCE,
          HOLD_REVERSAL,
          instResult
        );
      }
    }

    // Gate 1.6: Cluster filter — skip if same ticker had BUY recently
    if (config.clusterFilter.enabled && currentDate && recentBuyDates.length > 0) {
      const minGapMs = config.clusterFilter.minGapDays * 86400000;
      const tooRecent = recentBuyDates.some((d) => currentDate.getTime() - d.getTime() < minGapMs);
      if (tooRecent) {
        return makeHold(
          ticker,
          buyScore,
          sellScore,
          trendResult,
          HOLD_CONFLUENCE,
          HOLD_REVERSAL,
          instResult
        );
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
      const rsOk =
        q.rsMin === undefined ||
        (instResult.components.rsSpy >= q.rsMin && instResult.components.rsSector >= q.rsMin);
      const pullbackOk = !q.requireBelowSma50 || close < indicators.sma50;
      const qualified =
        ibs < q.ibsMax &&
        atrPct < q.atrPctMax &&
        volR > q.volRMin &&
        volR < q.volRMax &&
        (q.scoreMax === undefined || buyScore < q.scoreMax) &&
        rsOk &&
        pullbackOk;
      if (!qualified) {
        // Setup consumed: the score fired and the quality judgment is made once.
        // Callers should record this date in their cluster window so the same
        // deteriorating cluster cannot re-trigger on later (worse) bars.
        return {
          ...makeHold(
            ticker,
            buyScore,
            sellScore,
            trendResult,
            HOLD_CONFLUENCE,
            HOLD_REVERSAL,
            instResult
          ),
          qualityBlocked: true,
        };
      }
    }

    // Gate 2.5: Institutional score gate
    // For the 'institutional' strategy the score is already BLENDED into buyScore
    // via institutionalGradientScore — do NOT hard-gate here, allow the signal through.
    // For legacy strategies (momentum/mean-reversion) keep the original hard-gate.
    if (config.strategy !== 'institutional' && config.institutional.enabled && !instResult.passed) {
      return makeHold(
        ticker,
        buyScore,
        sellScore,
        trendResult,
        HOLD_CONFLUENCE,
        HOLD_REVERSAL,
        instResult
      );
    }

    // Gate 3: Confluence check
    const confluenceResult = confluenceCheck({ gradients, config: config.confluence });
    if (!confluenceResult.passed) {
      return makeHold(
        ticker,
        buyScore,
        sellScore,
        trendResult,
        confluenceResult,
        HOLD_REVERSAL,
        instResult
      );
    }

    // Gate 4: Reversal confirmation
    const reversalResult = reversalConfirm({
      recentCandles,
      volumeRatio: indicators.volumeRatio,
      config: config.reversalConfirm,
    });
    if (reversalResult.status === 'rejected') {
      return makeHold(
        ticker,
        buyScore,
        sellScore,
        trendResult,
        confluenceResult,
        reversalResult,
        instResult
      );
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

    if (cg.enabled && ensembleConfidence < cg.threshold) {
      return makeHold(
        ticker,
        buyScore,
        sellScore,
        trendResult,
        confluenceResult,
        reversalResult,
        instResult
      );
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
    };
  }

  // Check SELL path (no trend gate or reversal confirmation needed)
  if (sellScore >= config.thresholds.sell && sellScore > buyScore) {
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
    };
  }

  // HOLD
  return makeHold(
    ticker,
    buyScore,
    sellScore,
    trendResult,
    HOLD_CONFLUENCE,
    HOLD_REVERSAL,
    instResult
  );
}
