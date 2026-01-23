import pino from 'pino';
import { orderBy } from 'es-toolkit/array';
import { parseOptions } from './config';
import { getHistoricalPrices, getFearGreedIndex } from './services/data-fetcher';
import { calculateAllIndicators } from './services/indicators';
import { detectPatterns } from './services/patterns';
import { getOpinion } from './services/analysis';
import { writeToCsv } from './utils/csv-writer';
import { sendSlackNotification } from './utils/slack';
import {
  RISK_MULTIPLIER,
  REWARD_MULTIPLIER,
  TRAILING_MULTIPLIER,
  TRAILING_ACTIVATION_MULTIPLIER,
} from './constants';
import {
  addAsset,
  removeAsset,
  getPortfolio,
  generatePerformanceReport,
} from './portfolio/manager';
import type { TickerResult, CliOptions } from './types';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' }
});

async function processTicker(ticker: string, fearGreed: number | null): Promise<TickerResult | null> {
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
  const { score: patternScore, patterns } = detectPatterns({ highs, lows, closes });
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
    patternScore
  });

  const risk = indicators.atr * RISK_MULTIPLIER;
  const reward = risk * REWARD_MULTIPLIER;
  const direction = decision === 'SELL' ? -1 : 1;
  const stopLoss = latest.close - risk * direction;
  const takeProfit = latest.close + reward * direction;
  const trailingCandidate = latest.close - TRAILING_MULTIPLIER * indicators.atr * direction;
  const trailingStop =
    direction === 1
      ? Math.min(stopLoss, trailingCandidate)
      : Math.max(stopLoss, trailingCandidate);
  const trailingStart =
    latest.close + TRAILING_ACTIVATION_MULTIPLIER * indicators.atr * direction;

  return {
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
  };
}

async function fetchAndWrite(options: CliOptions): Promise<void> {
  const { tickers, slackWebhook, sort, portfolioAction, portfolioTicker, fundamentals, news } = parseOptions();
  const fearGreed = await getFearGreedIndex();

  // If fundamentals or news option is set, call portfolio functions instead of stock processing
  if (portfolioAction === 'list') {
    const portfolio = await getPortfolio();
    logger.info(JSON.stringify(portfolio, null, 2));
    process.exit(0);
  }

  if (portfolioAction === 'add' && portfolioTicker) {
    await addAsset(portfolioTicker);
    process.exit(0);
  }

  if (portfolioAction === 'remove' && portfolioTicker) {
    await removeAsset(portfolioTicker);
    process.exit(0);
  }

  if (portfolioAction === 'report') {
    const tickersToReport = portfolioTicker ? [portfolioTicker] : tickers;
    const results = (
      await Promise.all(tickersToReport.map((t) => processTicker(t, fearGreed)))
    ).filter((r): r is TickerResult => r !== null);
    await generatePerformanceReport(tickersToReport, results);
    process.exit(0);
  }

  if (fundamentals && portfolioTicker) {
    const fundamentals = await getFundamentals(portfolioTicker);
    logger.info('Fundamentals:', fundamentals);
    process.exit(0);
  }

  if (news && portfolioTicker) {
    const newsItems = await getStockNews(portfolioTicker, 5);
    logger.info(`Recent news for ${portfolioTicker}:`, newsItems);
    process.exit(0);
  }

  const { tickers: rawTickers } = options;
  const fearGreed = await getFearGreedIndex();
  const results = (
    await Promise.all(tickers.map((t) => processTicker(t, fearGreed)))
  ).filter((r): r is TickerResult => r !== null);
  const ordered = orderBy(results, ['ticker'], [sort]);
  await writeToCsv(ordered);

  if (slackWebhook) {
    const actionable = ordered.filter(
      (r) => r.opinion === 'BUY' || r.opinion === 'SELL'
    );
    await Promise.all(actionable.map((r) => sendSlackNotification(r, slackWebhook)));
  }
}

if (require.main === module) {
  const options = parseOptions();
  fetchAndWrite(options).catch((err) =>
    logger.error({ err }, 'Unexpected error')
  );
}