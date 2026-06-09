import { gradientScore } from '@/services/analysis';
import { confluenceCheck } from '@/services/confluence';
import type { BenchmarkCandle } from '@/services/data-fetcher';
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
  } = params;

  // Gate 1: Trend filter (buy-side only)
  const trendResult = trendGate({
    close,
    sma50: indicators.sma50,
    sma200: indicators.sma200,
    config: config.trendGate,
  });

  // Gate 2: Gradient scoring
  const { buyScore, sellScore, gradients } = gradientScore({
    indicators,
    close,
    fearGreed,
    patternScore,
    recentMacdHistogram,
    config,
  });

  // Gate 2.5: Institutional score (pre-compute, gate inside BUY path)
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

    // Gate 2.5: Institutional score gate
    if (config.institutional.enabled && !instResult.passed) {
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
