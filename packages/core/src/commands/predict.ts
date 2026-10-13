import * as fs from 'node:fs';
import { join } from 'node:path';
import { orderBy } from 'es-toolkit/array';
import pino from 'pino';
import { LOCAL_STORE_ROOT } from '@/portfolio/local-store';
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

/** Decision order for `--sort-by=decision`: actionable signals first. */
const DECISION_RANK: Record<string, number> = { BUY: 0, SELL: 1, HOLD: 2 };

type ExtraDataFlags = Pick<
  CliOptions,
  'fundamentals' | 'news' | 'options' | 'dividends' | 'earnings'
>;

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

/** Portfolio reports are saved next to the shared stores so every entry point finds them. */
export function portfolioReportPath(date = new Date()): string {
  return join(
    LOCAL_STORE_ROOT,
    'reports',
    `portfolio-report-${date.toISOString().slice(0, 10)}.md`
  );
}

function savePortfolioReport(report: string): string {
  const file = portfolioReportPath();
  fs.mkdirSync(join(file, '..'), { recursive: true });
  fs.writeFileSync(file, report, 'utf-8');
  return file;
}

export function sortResults(
  results: TickerResult[],
  sort: CliOptions['sort'],
  sortBy: CliOptions['sortBy'] = 'ticker'
): TickerResult[] {
  if (sortBy === 'decision') {
    return orderBy(
      results,
      [(r) => DECISION_RANK[r.opinion] ?? Number.MAX_SAFE_INTEGER, (r) => r.score, 'ticker'],
      ['asc', 'desc', 'asc']
    );
  }
  return orderBy(results, ['ticker'], [sort]);
}

function requestedExtras(flags: ExtraDataFlags): Array<keyof ExtraDataFlags> {
  return (['fundamentals', 'news', 'options', 'dividends', 'earnings'] as const).filter(
    (flag) => flags[flag]
  );
}

/** Prints the requested extra data for every ticker, sequentially to avoid provider bursts. */
async function printExtraData(tickers: string[], flags: ExtraDataFlags): Promise<void> {
  for (const ticker of tickers) {
    if (flags.fundamentals) {
      const fundamentalsData = await getFundamentals(ticker);
      logger.info({ ticker, fundamentals: fundamentalsData }, 'Fundamentals retrieved');
    }
    if (flags.options) {
      const optionsData = await getOptionsChain(ticker);
      logger.info({ ticker }, formatOptionsData(optionsData));
    }
    if (flags.dividends) {
      const dividendData = await getDividendInfo(ticker);
      logger.info({ ticker }, formatDividendInfo(dividendData));
    }
    if (flags.earnings) {
      const earningsData = await getEarningsData(ticker);
      logger.info({ ticker }, formatEarningsData(earningsData));
    }
    if (flags.news) {
      const newsItems = await getStockNews(ticker, 5);
      logger.info({ ticker, newsItems }, 'Recent news retrieved');
    }
  }
}

export async function predict(options: CliOptions): Promise<void> {
  const {
    tickers,
    slackWebhook,
    sort,
    sortBy,
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

  const extraFlags: ExtraDataFlags = {
    fundamentals,
    news,
    options: optionsFlag,
    dividends,
    earnings,
  };
  const extras = requestedExtras(extraFlags);

  if (portfolioAction === 'report') {
    const tickersToReport = portfolioTicker
      ? [portfolioTicker]
      : tickers.length > 0
        ? tickers
        : (await getPortfolio()).assets;
    if (tickersToReport.length === 0) {
      logger.warn(
        'Portfolio is empty; add assets with --portfolio-action=add --portfolio-ticker=<symbol> or pass --ticker'
      );
      return;
    }
    const fearGreed = await getFearGreedIndex();
    const pipelineConfig = await loadPipelineConfig();
    const results = (
      await Promise.all(tickersToReport.map((t) => processTicker(t, fearGreed, pipelineConfig)))
    ).filter((r): r is TickerResult => r !== null);
    const report = await generatePerformanceReport(tickersToReport, results);
    console.log(report);
    const file = savePortfolioReport(report);
    logger.info({ file, tickers: tickersToReport.length }, 'Portfolio report saved');
    return;
  }

  // Extra data without a prediction batch: legacy --portfolio-ticker usage.
  if (tickers.length === 0) {
    if (extras.length > 0) {
      if (!portfolioTicker) {
        logger.error(
          `Pass --ticker=<symbols> to use --${extras.join(', --')}; the flags apply to every listed symbol`
        );
        return;
      }
      await printExtraData([portfolioTicker], extraFlags);
    }
    return;
  }

  const fearGreed = await getFearGreedIndex();
  const contexts = new Map<string, TickerAnalysisContext>();
  const pipelineConfig = await loadPipelineConfig();
  const results = (
    await Promise.all(tickers.map((t) => processTicker(t, fearGreed, pipelineConfig, contexts)))
  ).filter((r): r is TickerResult => r !== null);
  const ordered = sortResults(results, sort, sortBy);

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

  if (extras.length > 0) {
    await printExtraData(tickers, extraFlags);
  }
}
