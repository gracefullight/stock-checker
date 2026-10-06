import * as fs from 'node:fs';
import { join } from 'node:path';
import { orderBy } from 'es-toolkit/array';
import pino from 'pino';
import {
  addAsset,
  generatePerformanceReport,
  getPortfolio,
  removeAsset,
} from '@/portfolio/manager';
import { getFearGreedIndex } from '@/services/data-fetcher';
import { formatDividendInfo, getDividendInfo } from '@/services/dividends';
import { formatEarningsData, getEarningsData } from '@/services/earnings';
import { getFundamentals } from '@/services/fundamentals';
import { getStockNews } from '@/services/news';
import { formatOptionsData, getOptionsChain } from '@/services/options';
import { analyzeTickerContext, type TickerAnalysisContext } from '@/services/ticker-analysis';
import type { CliOptions, PipelineConfig, PredictionRecord, TickerResult } from '@/types';
import { printSummaryTable } from '@/ui/summary';
import { loadPipelineConfig } from '@/utils/config-loader';
import { writeToCsv } from '@/utils/csv-writer';
import { exportToJson } from '@/utils/json-exporter';
import { sendSlackNotification } from '@/utils/slack';
import {
  buildStockSignalNotification,
  buildStockSignalReportNotification,
} from '@/utils/stock-alerts';
import { isWhatsAppNotificationConfigured, sendWhatsAppNotification } from '@/utils/whatsapp';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
});

async function processTicker(
  ticker: string,
  fearGreed: number | null,
  pipelineConfig: PipelineConfig,
  contexts?: Map<string, TickerAnalysisContext>
): Promise<TickerResult | null> {
  logger.info({ ticker }, 'Processing ticker');
  const context = await analyzeTickerContext(ticker, fearGreed, { pipelineConfig });
  if (!context) {
    logger.warn({ ticker }, 'No usable price/ATR analysis');
    return null;
  }
  contexts?.set(ticker, context);
  return context.result;
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
    const pipelineConfig = await loadPipelineConfig();
    const results = (
      await Promise.all(tickersToReport.map((t) => processTicker(t, fearGreed, pipelineConfig)))
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

  const contexts = new Map<string, TickerAnalysisContext>();
  const pipelineConfig = await loadPipelineConfig();
  const results = (
    await Promise.all(tickers.map((t) => processTicker(t, fearGreed, pipelineConfig, contexts)))
  ).filter((r): r is TickerResult => r !== null);
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

  try {
    const basicNotification = buildStockSignalNotification(ordered);
    const notification =
      basicNotification && (await isWhatsAppNotificationConfigured())
        ? await buildStockSignalReportNotification(ordered, contexts)
        : basicNotification;
    if (notification) {
      const result = await sendWhatsAppNotification(notification);
      if (result.status === 'accepted') {
        logger.info('WhatsApp signal notification accepted by the local gateway');
      } else if (result.status === 'failed' || result.reason === 'invalid-configuration') {
        logger.warn(
          { status: result.status, reason: result.reason },
          'WhatsApp signal notification was not accepted'
        );
      }
    }
  } catch {
    logger.warn('WhatsApp signal notification failed; prediction results are saved');
  }
}
