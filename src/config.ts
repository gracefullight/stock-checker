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
    .option('--sort <order>', 'Sort order: asc or desc', 'asc');
  program.parse(process.argv);

  const opts = program.opts<{
    ticker?: string;
    slackWebhook?: string;
    sort?: 'asc' | 'desc';
  }>();

  const rawTickers = process.env.npm_config_ticker ?? opts.ticker;

  if (!rawTickers) {
    logger.error('Ticker argument is required. Use --ticker=TSLA,PLTR');
    process.exit(1);
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

  return { tickers, slackWebhook, sort };
}