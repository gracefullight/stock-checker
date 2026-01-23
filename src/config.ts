import { Command } from 'commander';
import pino from 'pino';
import type { CliOptions } from './types';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' }
});

export function parseOptions(): CliOptions {
  const program = new Command();
  program
    .option('--ticker <list>', 'Comma-separated tickers')
    .option('--slack-webhook <url>', 'Slack webhook URL')
    .option('--sort <order>', 'Sort order: asc or desc', 'asc')
    .option('--portfolio-action <action>', 'Portfolio action: add, remove, list, report')
    .option('--portfolio-ticker <ticker>', 'Portfolio ticker symbol')
    .option('--fundamentals', 'Show fundamentals for ticker')
    .option('--news', 'Show recent news for ticker');
  program.parse(process.argv);

  const opts = program.opts<{
    ticker?: string;
    slackWebhook?: string;
    sort?: 'asc' | 'desc';
    portfolioAction?: string;
    portfolioTicker?: string;
    fundamentals?: boolean;
    news?: boolean;
  }>();

  // If portfolio action is set, use single ticker instead of comma-separated tickers
  if (opts.portfolioAction && opts.portfolioAction !== 'list' && opts.portfolioAction !== 'report') {
    const rawTickers = opts.portfolioTicker ?? '';
    const tickers = [rawTickers];
  } else {
    const rawTickers = process.env.npm_config_ticker ?? opts.ticker;

    if (!rawTickers && !opts.portfolioAction) {
      logger.error('Ticker argument is required. Use --ticker=TSLA,PLTR or --portfolio-action add/remove/list/report');
      process.exit(1);
    }
  }

  const tickers = rawTickers ? [rawTickers] : rawTickers.split(',').map((t) => t.trim()).filter(Boolean);
  const slackWebhook =
    process.env.SLACK_WEBHOOK_URL ??
    (process.env.npm_config_slack_webhook as string | undefined) ??
    opts.slackWebhook;
  const sort =
    (process.env.npm_config_sort as 'asc' | 'desc' | undefined) ?? opts.sort ?? 'asc';

  if (sort !== 'asc' && sort !== 'desc') {
    logger.error("Sort option must be 'asc' or 'desc'");
    process.exit(1);
  }

  return { tickers, slackWebhook, sort, portfolioAction, portfolioTicker, fundamentals, news };
}

  const tickers = rawTickers.split(',').map((t) => t.trim()).filter(Boolean);
  const slackWebhook =
    process.env.SLACK_WEBHOOK_URL ??
    (process.env.npm_config_slack_webhook as string | undefined) ??
    opts.slackWebhook;
  const sort =
    (process.env.npm_config_sort as 'asc' | 'desc' | undefined) ?? opts.sort ?? 'asc';

  if (sort !== 'asc' && sort !== 'desc') {
    logger.error("Sort option must be 'asc' or 'desc'");
    process.exit(1);
  }

  return { tickers, slackWebhook, sort, portfolioAction, portfolioTicker, fundamentals, news };
}