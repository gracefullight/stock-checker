import type {
  CandleData,
  ConfluenceResult,
  IndicatorValues,
  PipelineConfig,
  PipelineResult,
  ReversalConfirmation,
  TrendGateResult,
} from '@/types';
import { gradientScore } from './analysis';
import { confluenceCheck } from './confluence';
import { reversalConfirm } from './reversal-confirm';
import { trendGate } from './trend-gate';

const HOLD_TREND: TrendGateResult = {
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

function makeHold(
  ticker: string,
  buyScore: number,
  sellScore: number,
  trend: TrendGateResult,
  confluence: ConfluenceResult,
  reversal: ReversalConfirmation,
): PipelineResult {
  return {
    ticker,
    finalDecision: 'HOLD',
    score: Math.max(buyScore, sellScore),
    buyScore,
    sellScore,
    gateResults: { trend, confluence, reversal },
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
}): PipelineResult {
  const { ticker, indicators, close, open, fearGreed, patternScore, recentCandles, recentMacdHistogram, config,
    recentBuyDates = [], currentDate } =
    params;

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

  // Check BUY path
  if (buyScore >= config.thresholds.buy && buyScore >= sellScore) {
    // Trend gate blocks buys in downtrends
    if (!trendResult.passed) {
      return makeHold(ticker, buyScore, sellScore, trendResult, HOLD_CONFLUENCE, HOLD_REVERSAL);
    }

    // Gate 1.5: Regime filter — block uptrend regime (mean-reversion works better in downtrends)
    if (config.regimeFilter.enabled && config.regimeFilter.blockUptrend && trendResult.regime === 'uptrend') {
      return makeHold(ticker, buyScore, sellScore, trendResult, HOLD_CONFLUENCE, HOLD_REVERSAL);
    }

    // Gate 1.6: Volume spike filter — abnormally high volume often signals panic selling
    if (config.volumeSpike.enabled && indicators.volumeRatio > config.volumeSpike.maxVolumeRatio) {
      return makeHold(ticker, buyScore, sellScore, trendResult, HOLD_CONFLUENCE, HOLD_REVERSAL);
    }

    // Gate 1.7: Cluster filter — skip if same ticker had BUY recently
    if (config.clusterFilter.enabled && currentDate && recentBuyDates.length > 0) {
      const minGapMs = config.clusterFilter.minGapDays * 86400000;
      const tooRecent = recentBuyDates.some(d => currentDate.getTime() - d.getTime() < minGapMs);
      if (tooRecent) {
        return makeHold(ticker, buyScore, sellScore, trendResult, HOLD_CONFLUENCE, HOLD_REVERSAL);
      }
    }

    // Gate 3: Confluence check
    const confluenceResult = confluenceCheck({ gradients, config: config.confluence });
    if (!confluenceResult.passed) {
      return makeHold(ticker, buyScore, sellScore, trendResult, confluenceResult, HOLD_REVERSAL);
    }

    // Gate 4: Reversal confirmation
    const reversalResult = reversalConfirm({
      recentCandles,
      volumeRatio: indicators.volumeRatio,
      config: config.reversalConfirm,
    });
    if (reversalResult.status === 'rejected') {
      return makeHold(ticker, buyScore, sellScore, trendResult, confluenceResult, reversalResult);
    }

    // Gate 5: Ensemble confidence
    const trendNorm = trendResult.strength / 100; // 0-1
    const scoreNorm = Math.min((buyScore - config.thresholds.buy) / config.thresholds.buy, 1); // how far above threshold
    const confNorm = confluenceResult.ratio; // 0-1
    const revNorm = reversalResult.trigger === 'both' ? 1.0 : reversalResult.trigger === 'bullish_candle' ? 0.5 : 0;

    const cg = config.confidenceGate;
    const ensembleConfidence =
      (cg.weights.trend * trendNorm +
       cg.weights.score * scoreNorm +
       cg.weights.confluence * confNorm +
       cg.weights.reversal * revNorm) * 100;

    if (cg.enabled && ensembleConfidence < cg.threshold) {
      return makeHold(ticker, buyScore, sellScore, trendResult, confluenceResult, reversalResult);
    }

    return {
      ticker,
      finalDecision: 'BUY',
      score: buyScore,
      buyScore,
      sellScore,
      gateResults: { trend: trendResult, confluence: confluenceResult, reversal: reversalResult },
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
      gateResults: { trend: trendResult, confluence: HOLD_CONFLUENCE, reversal: HOLD_REVERSAL },
      confidence: 0,
    };
  }

  // HOLD
  return makeHold(ticker, buyScore, sellScore, trendResult, HOLD_CONFLUENCE, HOLD_REVERSAL);
}
