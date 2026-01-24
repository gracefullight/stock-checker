import * as fs from 'node:fs';
import { join } from 'node:path';
import { orderBy } from 'es-toolkit/array';
import pino from 'pino';
import {
  REWARD_MULTIPLIER,
  RISK_MULTIPLIER,
  TRAILING_ACTIVATION_MULTIPLIER,
  TRAILING_MULTIPLIER,
} from '@/constants';
import {
  addAsset,
  generatePerformanceReport,
  getPortfolio,
  removeAsset,
} from '@/portfolio/manager';
import { getOpinion } from '@/services/analysis';
import { getFearGreedIndex, getHistoricalPrices } from '@/services/data-fetcher';
import { formatDividendInfo, getDividendInfo } from '@/services/dividends';
import { formatEarningsData, getEarningsData } from '@/services/earnings';
import { getFundamentals } from '@/services/fundamentals';
import { calculateAllIndicators } from '@/services/indicators';
import { getStockNews } from '@/services/news';
import { formatOptionsData, getOptionsChain } from '@/services/options';
import { detectPatterns } from '@/services/patterns';
import { calculateProbabilities } from '@/services/probability';
import type { CliOptions, PredictionRecord, TickerResult } from '@/types';
import { loadOptimizedConfig } from '@/utils/config-loader';
import { writeToCsv } from '@/utils/csv-writer';
import { exportToJson } from '@/utils/json-exporter';
import { sendSlackNotification } from '@/utils/slack';

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
  const dailyPrices = await getHistoricalPrices(ticker, 365);
  if (dailyPrices.length === 0) {
    logger.warn({ ticker }, 'No price data');
    return null;
  }

  const latest = dailyPrices[dailyPrices.length - 1];
  const dateStr = latest.date.toISOString().split('T')[0];
  const closes = dailyPrices.map((d) => d.close);
  const highs = dailyPrices.map((d) => d.high);
  const lows = dailyPrices.map((d) => d.low);

  const indicators = calculateAllIndicators({ closes, highs, lows });
  const optimizedConfig = await loadOptimizedConfig();
  const { score: patternScore, patterns } = detectPatterns(
    { highs, lows, closes },
    optimizedConfig.patternWeights
  );

  const { decision, score } = getOpinion({
    rsi: indicators.rsi,
    stochasticK: indicators.stochasticK,
    williamsR: indicators.williamsR,
    close: latest.close,
    bbLower: indicators.bbLower,
    bbUpper: indicators.bbUpper,
    donchLower: indicators.donchLower,
    donchUpper: indicators.donchUpper,
    fearGreed,
    patternScore,
    buyThreshold: optimizedConfig.thresholds.buy,
    sellThreshold: optimizedConfig.thresholds.sell,
  });

  const probs = calculateProbabilities(score, score, optimizedConfig.calibration);

  const risk = indicators.atr * RISK_MULTIPLIER;
  const reward = risk * REWARD_MULTIPLIER;
  const direction = decision === 'SELL' ? -1 : 1;
  const stopLoss = latest.close - risk * direction;
  const takeProfit = latest.close + reward * direction;
  const trailingCandidate = latest.close - TRAILING_MULTIPLIER * indicators.atr * direction;
  const trailingStop =
    direction === 1 ? Math.min(stopLoss, trailingCandidate) : Math.max(stopLoss, trailingCandidate);
  const trailingStart = latest.close + TRAILING_ACTIVATION_MULTIPLIER * indicators.atr * direction;

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
    stopLoss,
    takeProfit,
    trailingStop,
    trailingStart,
    macd: indicators.macd,
    macdSignal: indicators.macdSignal,
    macdHistogram: indicators.macdHistogram,
    sma20: indicators.sma20,
    ema20: indicators.ema20,
    buyProbability: probs.buyProbability,
    sellProbability: probs.sellProbability,
    holdProbability: probs.holdProbability,
    confidence: probs.confidence,
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
  const fearGreed = await getFearGreedIndex();

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

  if (slackWebhook) {
    const actionable = ordered.filter((r) => r.opinion === 'BUY' || r.opinion === 'SELL');
    await Promise.all(actionable.map((r) => sendSlackNotification(r, slackWebhook)));
  }

  await savePredictions(ordered);
}
