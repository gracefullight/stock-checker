import * as fs from 'node:fs';
import { join } from 'node:path';
import { orderBy } from 'es-toolkit/array';
import pino from 'pino';
import { DEFAULT_PIPELINE_CONFIG, MARKET_BENCHMARK, SECTOR_ETF_MAP } from '@/constants';
import { TICKER_SECTOR_ETF } from '@/constants/tickers';
import {
  addAsset,
  generatePerformanceReport,
  getPortfolio,
  removeAsset,
} from '@/portfolio/manager';
import {
  fetchBenchmarkPrices,
  getFearGreedIndex,
  getHistoricalPrices,
} from '@/services/data-fetcher';
import { formatDividendInfo, getDividendInfo } from '@/services/dividends';
import { formatEarningsData, getEarningsData } from '@/services/earnings';
import { getFundamentals } from '@/services/fundamentals';
import { gaussianChannel } from '@/services/gaussian-channel';
import { calcRecentMacdHistogram, calculateAllIndicators } from '@/services/indicators';
import { getStockNews } from '@/services/news';
import { formatOptionsData, getOptionsChain } from '@/services/options';
import { detectPatterns } from '@/services/patterns';
import { evaluateSignal } from '@/services/pipeline';
import { calculateProbabilities } from '@/services/probability';
import { calculateLongRiskLevels } from '@/services/risk-levels';
import type {
  CandleData,
  CliOptions,
  PipelineConfig,
  PredictionRecord,
  TickerResult,
} from '@/types';
import { printSummaryTable } from '@/ui/summary';
import { loadOptimizedConfig } from '@/utils/config-loader';
import { writeToCsv } from '@/utils/csv-writer';
import { exportToJson } from '@/utils/json-exporter';
import { sendSlackNotification } from '@/utils/slack';
import { buildStockSignalNotification } from '@/utils/stock-alerts';
import { sendWhatsAppNotification } from '@/utils/whatsapp';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
});

async function processTicker(
  ticker: string,
  fearGreed: number | null
): Promise<TickerResult | null> {
  logger.info({ ticker }, 'Processing ticker');
  const dailyPrices = await getHistoricalPrices(ticker, 730);
  if (dailyPrices.length === 0) {
    logger.warn({ ticker }, 'No price data');
    return null;
  }

  const latest = dailyPrices[dailyPrices.length - 1];
  const dateStr = latest.date.toISOString().split('T')[0];
  const closes = dailyPrices.map((d) => d.close);
  const highs = dailyPrices.map((d) => d.high);
  const lows = dailyPrices.map((d) => d.low);
  const volumes = dailyPrices.map((d) => d.volume);

  const indicators = calculateAllIndicators({ closes, highs, lows, volumes });
  const riskLevels = calculateLongRiskLevels(latest.close, indicators.atr);
  if (!riskLevels) {
    logger.warn({ ticker }, 'Insufficient price/ATR data for valid long-position risk levels');
    return null;
  }
  const optimizedConfig = await loadOptimizedConfig();
  const { score: patternScore, patterns } = detectPatterns(
    { highs, lows, closes },
    optimizedConfig.patternWeights
  );

  // Build pipeline config from optimized + defaults
  const pipelineConfig: PipelineConfig = {
    ...DEFAULT_PIPELINE_CONFIG,
    indicatorWeights: optimizedConfig.weights as PipelineConfig['indicatorWeights'],
    thresholds: optimizedConfig.thresholds,
    patternWeights: optimizedConfig.patternWeights,
    calibration: optimizedConfig.calibration,
    ...(optimizedConfig.trendGate && { trendGate: optimizedConfig.trendGate }),
    ...(optimizedConfig.gradientRanges && { gradientRanges: optimizedConfig.gradientRanges }),
    ...(optimizedConfig.confluence && { confluence: optimizedConfig.confluence }),
    ...(optimizedConfig.reversalConfirm && { reversalConfirm: optimizedConfig.reversalConfirm }),
  };

  // Prepare recent candles for reversal confirmation
  const recentCandles: CandleData[] = dailyPrices.slice(-3).map((d) => ({
    open: d.open,
    close: d.close,
    high: d.high,
    low: d.low,
    volume: d.volume,
  }));

  // Compute recent MACD histogram for crossover detection
  const recentMacdHistogram = calcRecentMacdHistogram(closes);

  // Benchmark prices for institutional scoring
  const spyCandles = (await fetchBenchmarkPrices(MARKET_BENCHMARK)).filter(
    (candle) => candle.date.toISOString().slice(0, 10) <= dateStr
  );
  // Market-level regime for the quality gate's kill-switch (essay #2 at the
  // index level). null when SPY data is unavailable — the gate never blocks
  // on an unknown regime.
  const marketUptrend =
    spyCandles.length >= 2 ? gaussianChannel(spyCandles.map((c) => c.close)).isGreen : null;
  let sectorETF: string | undefined = TICKER_SECTOR_ETF[ticker];
  try {
    const fund = await getFundamentals(ticker);
    if (fund?.sector && SECTOR_ETF_MAP[fund.sector]) {
      sectorETF = SECTOR_ETF_MAP[fund.sector];
    }
  } catch {
    /* keep the static sector mapping, when known */
  }
  const sectorCandles = sectorETF
    ? (await fetchBenchmarkPrices(sectorETF)).filter(
        (candle) => candle.date.toISOString().slice(0, 10) <= dateStr
      )
    : [];

  const recent20 = dailyPrices.slice(-20);
  const avgDailyDollarVol =
    recent20.reduce((sum, day) => sum + (day.dollarVolume ?? day.close * day.volume), 0) /
    recent20.length;

  let earningsBeat: boolean | null = null;
  let earningsEstimateUp: boolean | null = null;
  try {
    const earningsInfo = await getEarningsData(ticker);
    const hist = earningsInfo?.earningsHistory;
    if (hist && hist.length > 0) {
      const last = hist[hist.length - 1];
      if (last.epsActual != null && last.epsEstimate != null) {
        earningsBeat = last.epsActual > last.epsEstimate;
      }
    }
    const revisionDirection = earningsInfo?.estimateRevisions?.direction;
    earningsEstimateUp =
      revisionDirection === 'up' ? true : revisionDirection === 'down' ? false : null;
  } catch {
    /* fallback */
  }

  const pipelineResult = evaluateSignal({
    ticker,
    indicators,
    close: latest.close,
    open: latest.open,
    // Alternative.me measures Bitcoin sentiment, not US equity sentiment.
    fearGreed: null,
    patternScore,
    recentCandles,
    recentMacdHistogram,
    config: pipelineConfig,
    allCloses: closes,
    allDates: dailyPrices.map((day) => day.date),
    allHighs: highs,
    allLows: lows,
    allVolumes: volumes,
    spyCandles,
    sectorCandles,
    avgDailyDollarVol,
    earningsBeat,
    earningsEstimateUp,
    marketUptrend,
  });

  const { finalDecision: decision, score, buyScore, sellScore } = pipelineResult;
  const probs = calculateProbabilities(buyScore, sellScore, optimizedConfig.calibration);

  const result: TickerResult = {
    ticker,
    date: dateStr,
    close: latest.close,
    volume: latest.volume,
    rsi: indicators.rsi,
    stochasticK: indicators.stochasticK,
    bbLower: indicators.bbLower,
    bbUpper: indicators.bbUpper,
    donchLower: indicators.donchLower,
    donchUpper: indicators.donchUpper,
    williamsR: indicators.williamsR,
    fearGreed,
    patterns,
    score,
    opinion: decision,
    atr: indicators.atr,
    ...riskLevels,
    macd: indicators.macd,
    macdSignal: indicators.macdSignal,
    macdHistogram: indicators.macdHistogram,
    sma20: indicators.sma20,
    ema20: indicators.ema20,
    buyProbability: probs.buyProbability,
    sellProbability: probs.sellProbability,
    holdProbability: probs.holdProbability,
    confidence: probs.confidence,
    sma50: indicators.sma50,
    sma200: indicators.sma200,
    volumeRatio: indicators.volumeRatio,
    trendRegime: pipelineResult.gateResults.trend.regime,
    confluenceRatio: pipelineResult.gateResults.confluence.ratio,
    institutionalScore: pipelineResult.gateResults.institutional.score,
    institutionalPassed: pipelineResult.gateResults.institutional.passed,
  };

  return result;
}

async function savePredictions(results: TickerResult[]): Promise<void> {
  const FEEDBACK_DIR = join(process.cwd(), 'data', 'feedback');
  if (!fs.existsSync(FEEDBACK_DIR)) {
    fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const filename = join(FEEDBACK_DIR, `predictions_${dateStr}.json`);

  const predictions: PredictionRecord[] = results.map((r) => ({
    ticker: r.ticker,
    date: r.date,
    opinion: r.opinion,
    score: r.score,
    buyProbability: r.buyProbability ?? 0,
    sellProbability: r.sellProbability ?? 0,
    holdProbability: r.holdProbability ?? 0,
    confidence: r.confidence ?? 'medium',
    close: r.close,
    indicators: {
      rsi: r.rsi,
      stochasticK: r.stochasticK,
      williamsR: r.williamsR,
      patternScore: r.patterns?.length || 0,
      macd: r.macd,
      macdSignal: r.macdSignal,
      macdHistogram: r.macdHistogram,
      sma20: r.sma20,
      ema20: r.ema20,
    },
  }));

  fs.writeFileSync(filename, JSON.stringify(predictions, null, 2), 'utf-8');
  logger.info(`Saved ${predictions.length} predictions to ${filename}`);
}

export async function predict(options: CliOptions): Promise<void> {
  const {
    tickers,
    slackWebhook,
    sort,
    portfolioAction,
    portfolioTicker,
    fundamentals,
    news,
    options: optionsFlag,
    dividends,
    earnings,
    format,
  } = options;
  if (portfolioAction === 'list') {
    const portfolio = await getPortfolio();
    logger.info(JSON.stringify(portfolio, null, 2));
    return;
  }

  if (portfolioAction === 'add' && portfolioTicker) {
    await addAsset(portfolioTicker);
    return;
  }

  if (portfolioAction === 'remove' && portfolioTicker) {
    await removeAsset(portfolioTicker);
    return;
  }

  const fearGreed = await getFearGreedIndex();

  if (portfolioAction === 'report') {
    const tickersToReport = portfolioTicker ? [portfolioTicker] : tickers;
    const results = (
      await Promise.all(tickersToReport.map((t) => processTicker(t, fearGreed)))
    ).filter((r): r is TickerResult => r !== null);
    await generatePerformanceReport(tickersToReport, results);
    return;
  }

  if (fundamentals && portfolioTicker) {
    const fundamentalsData = await getFundamentals(portfolioTicker);
    logger.info(
      { ticker: portfolioTicker, fundamentals: fundamentalsData },
      'Fundamentals retrieved'
    );
    return;
  }

  if (optionsFlag && portfolioTicker) {
    const optionsData = await getOptionsChain(portfolioTicker);
    logger.info(formatOptionsData(optionsData));
    return;
  }

  if (dividends && portfolioTicker) {
    const dividendData = await getDividendInfo(portfolioTicker);
    logger.info(formatDividendInfo(dividendData));
    return;
  }

  if (earnings && portfolioTicker) {
    const earningsData = await getEarningsData(portfolioTicker);
    logger.info(formatEarningsData(earningsData));
    return;
  }

  if (news && portfolioTicker) {
    const newsItems = await getStockNews(portfolioTicker, 5);
    logger.info({ ticker: portfolioTicker, newsItems }, 'Recent news retrieved');
    return;
  }

  const results = (await Promise.all(tickers.map((t) => processTicker(t, fearGreed)))).filter(
    (r): r is TickerResult => r !== null
  );
  const ordered = orderBy(results, ['ticker'], [sort]);

  if (format === 'json') {
    await exportToJson(ordered);
  } else {
    await writeToCsv(ordered);
  }

  printSummaryTable(ordered);

  if (slackWebhook) {
    const actionable = ordered.filter((r) => r.opinion === 'BUY' || r.opinion === 'SELL');
    await Promise.all(actionable.map((r) => sendSlackNotification(r, slackWebhook)));
  }

  await savePredictions(ordered);

  const notification = buildStockSignalNotification(ordered);
  if (notification) {
    try {
      const result = await sendWhatsAppNotification(notification);
      if (result.status === 'accepted') {
        logger.info('WhatsApp signal notification accepted by Meta');
      } else if (result.status === 'failed' || result.reason === 'invalid-configuration') {
        logger.warn(
          { status: result.status, reason: result.reason },
          'WhatsApp signal notification was not accepted'
        );
      }
    } catch {
      logger.warn('WhatsApp signal notification failed; prediction results are saved');
    }
  }
}
